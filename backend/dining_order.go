package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type diningModifier struct {
	GroupID  string `json:"groupId"`
	OptionID string `json:"optionId"`
}
type diningLine struct {
	MenuItemID string           `json:"menuItemId"`
	Quantity   int              `json:"quantity"`
	Modifiers  []diningModifier `json:"modifiers"`
}
type diningOrderRequest struct {
	OrderType     string       `json:"orderType"`
	SessionID     string       `json:"sessionId"`
	PaymentMethod string       `json:"paymentMethod"`
	Items         []diningLine `json:"items"`
	Key           string       `json:"idempotencyKey"`
}
type resolvedDiningLine struct {
	id, name, station, mods string
	price, total            int64
	quantity                int
}

func (a *App) diningOrder(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Use POST")
		return
	}
	if g.Role == "readonly" {
		fail(w, 403, "A write-enabled role is required")
		return
	}
	var in diningOrderRequest
	if body(r, &in) != nil || len(in.Key) < 8 || len(in.Key) > 128 || len(in.Items) < 1 || len(in.Items) > 100 || len(in.SessionID) > 256 || (in.OrderType != "dine_in" && in.OrderType != "takeout") || (in.OrderType == "dine_in" && in.SessionID == "") || (in.OrderType == "takeout" && in.PaymentMethod != "cash" && in.PaymentMethod != "mock_card") {
		fail(w, 400, "Invalid dining order")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, 503, "Dining service unavailable")
		return
	}
	defer tx.Rollback()
	raw, _ := json.Marshal(in)
	hash := digest(id.UserID + "\x00" + string(raw))
	const endpoint = "/station/dining/order"
	var oldHash, oldBody string
	e = tx.QueryRow("SELECT request_hash,response_body FROM idempotency_keys WHERE organization_id=? AND key=? AND endpoint=?", id.OrganizationID, in.Key, endpoint).Scan(&oldHash, &oldBody)
	if e == nil {
		if oldHash != hash {
			fail(w, 409, "Retry key already used")
			return
		}
		var v map[string]any
		if json.Unmarshal([]byte(oldBody), &v) != nil {
			fail(w, 500, "Invalid retry result")
			return
		}
		ok(w, v)
		return
	}
	if !errors.Is(e, sql.ErrNoRows) {
		fail(w, 503, "Cannot read retry state")
		return
	}
	var rate int64
	if in.OrderType == "dine_in" {
		e = tx.QueryRow("SELECT l.service_fee_rate FROM dining_table_sessions s JOIN dining_tables t ON t.id=s.table_id AND t.organization_id=s.organization_id JOIN dining_locations l ON l.id=t.location_id AND l.organization_id=t.organization_id WHERE s.organization_id=? AND s.id=? AND s.status='active'", id.OrganizationID, in.SessionID).Scan(&rate)
		if errors.Is(e, sql.ErrNoRows) {
			fail(w, 409, "Table session is not active")
			return
		}
		if e != nil || rate < 0 || rate > 100 {
			fail(w, 503, "Cannot read service rate")
			return
		}
	}
	type group struct {
		id                 string
		min, max, required int
	}
	groups := []group{}
	rows, e := tx.Query("SELECT id,min_selection,max_selection,is_required FROM dining_modifier_groups WHERE organization_id=?", id.OrganizationID)
	if e != nil {
		fail(w, 503, "Cannot read modifier groups")
		return
	}
	for rows.Next() {
		var x group
		if e = rows.Scan(&x.id, &x.min, &x.max, &x.required); e != nil {
			break
		}
		groups = append(groups, x)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		fail(w, 503, "Cannot read modifier groups")
		return
	}
	lines := []resolvedDiningLine{}
	var subtotal int64
	for _, item := range in.Items {
		if len(item.MenuItemID) == 0 || len(item.MenuItemID) > 256 || item.Quantity < 1 || item.Quantity > 100 || len(item.Modifiers) > 100 {
			fail(w, 400, "Invalid order item")
			return
		}
		var name, category, station string
		var price int64
		var sold int
		e = tx.QueryRow("SELECT name,category,station,price,is_sold_out FROM dining_menu_items WHERE organization_id=? AND id=?", id.OrganizationID, item.MenuItemID).Scan(&name, &category, &station, &price, &sold)
		if errors.Is(e, sql.ErrNoRows) {
			fail(w, 404, "Menu item not found")
			return
		}
		if e != nil {
			fail(w, 503, "Cannot read menu item")
			return
		}
		if sold != 0 {
			fail(w, 409, "Menu item is sold out")
			return
		}
		if price < 0 || price > 100000000 {
			fail(w, 409, "Invalid menu price")
			return
		}
		chosen := map[string]bool{}
		counts := map[string]int{}
		names := []string{}
		for _, m := range item.Modifiers {
			if len(m.GroupID) > 256 || len(m.OptionID) > 256 || chosen[m.OptionID] {
				fail(w, 400, "Invalid or duplicate modifier")
				return
			}
			chosen[m.OptionID] = true
			counts[m.GroupID]++
			var option string
			var extra int64
			e = tx.QueryRow("SELECT name,additional_price FROM dining_modifier_options WHERE organization_id=? AND group_id=? AND id=?", id.OrganizationID, m.GroupID, m.OptionID).Scan(&option, &extra)
			if errors.Is(e, sql.ErrNoRows) {
				fail(w, 404, "Modifier not found")
				return
			}
			if e != nil || extra < 0 || extra > 100000000 {
				fail(w, 409, "Invalid modifier price")
				return
			}
			price += extra
			names = append(names, option)
		}
		for _, group := range groups {
			n := counts[group.id]
			if n > group.max || (category == "飲品" && group.required != 0 && (n == 0 || n < group.min)) {
				fail(w, 400, "Modifier selection does not meet group requirements")
				return
			}
		}
		lineTotal := price * int64(item.Quantity)
		subtotal += lineTotal
		if subtotal > 1000000000000 {
			fail(w, 400, "Order total exceeds limit")
			return
		}
		encoded, _ := json.Marshal(names)
		lines = append(lines, resolvedDiningLine{item.MenuItemID, name, station, string(encoded), price, lineTotal, item.Quantity})
	}
	fee := (subtotal*rate + 50) / 100
	total := subtotal + fee
	order := "order_" + token()
	takeout := ""
	var session any = in.SessionID
	if in.OrderType == "takeout" {
		takeout = "TO-" + strings.ToUpper(token()[:12])
		session = nil
	}
	var number any = nil
	if takeout != "" {
		number = takeout
	}
	_, e = tx.Exec("INSERT INTO dining_orders(id,organization_id,session_id,order_type,takeout_number,subtotal,service_charge,total_amount,status,idempotency_key) VALUES(?,?,?,?,?,?,?,?, 'placed',?)", order, id.OrganizationID, session, in.OrderType, number, subtotal, fee, total, in.Key)
	for _, line := range lines {
		if e != nil {
			break
		}
		itemID := "item_" + token()
		_, e = tx.Exec("INSERT INTO dining_order_items(id,organization_id,order_id,menu_item_id,item_name,unit_price,quantity,modifiers_json,line_total,status) VALUES(?,?,?,?,?,?,?,?,?,'pending')", itemID, id.OrganizationID, order, line.id, line.name, line.price, line.quantity, line.mods, line.total)
		if e == nil {
			_, e = tx.Exec("INSERT INTO dining_kitchen_tickets(id,organization_id,order_id,order_item_id,station,item_name,quantity,modifiers_text,status) VALUES(?,?,?,?,?,?,?,?,'received')", "kitchen_"+token(), id.OrganizationID, order, itemID, line.station, line.name, line.quantity, line.mods)
		}
	}
	if e == nil && in.OrderType == "takeout" {
		bill := "bill_" + token()
		_, e = tx.Exec("INSERT INTO dining_bills(id,organization_id,order_id,subtotal,service_charge,final_amount,paid_amount,status) VALUES(?,?,?,?,0,?,?,'paid')", bill, id.OrganizationID, order, subtotal, total, total)
		if e == nil {
			_, e = tx.Exec("INSERT INTO dining_payments(id,organization_id,bill_id,amount,payment_method,split_index) VALUES(?,?,?,?,?,1)", "pay_"+token(), id.OrganizationID, bill, total, in.PaymentMethod)
		}
	}
	result := map[string]any{"orderId": order, "takeoutNumber": takeout, "subtotal": subtotal, "serviceCharge": fee, "total": total}
	encoded, _ := json.Marshal(result)
	if e == nil {
		_, e = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", "idem_"+token(), id.OrganizationID, in.Key, endpoint, hash, string(encoded))
	}
	if e == nil {
		_, e = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,after_value) VALUES(?,?,?,?,'dining.order','dining_order',?,?)", "audit_"+token(), id.OrganizationID, id.UserID, g.Role, order, string(encoded))
	}
	if e != nil {
		fail(w, 503, "Cannot save dining order")
		return
	}
	if tx.Commit() != nil {
		fail(w, 503, "Cannot commit dining order")
		return
	}
	ok(w, result)
}
