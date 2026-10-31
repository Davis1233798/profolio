package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

type diningServiceRequest struct {
	Action          string `json:"action"`
	TicketID        string `json:"ticketId"`
	ItemID          string `json:"itemId"`
	Reason          string `json:"reason"`
	TableID         string `json:"tableId"`
	Name            string `json:"name"`
	Phone           string `json:"phone"`
	Guests          int    `json:"guests"`
	ReservationTime string `json:"reservationTime"`
	Key             string `json:"idempotencyKey"`
}

func (a *App) diningService(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Use POST")
		return
	}
	if g.Role == "readonly" {
		fail(w, 403, "A write-enabled role is required")
		return
	}
	var in diningServiceRequest
	if body(r, &in) != nil || len(in.Key) < 8 || len(in.Key) > 128 || len(in.TicketID) > 256 || len(in.ItemID) > 256 || len(in.TableID) > 256 || (in.Action != "reserve" && in.Action != "urge" && in.Action != "cancel") {
		fail(w, 400, "Invalid dining request")
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	in.Phone = strings.TrimSpace(in.Phone)
	in.Reason = strings.TrimSpace(in.Reason)
	var when time.Time
	var e error
	if in.Action == "reserve" {
		when, e = time.Parse(time.RFC3339, in.ReservationTime)
		if e != nil || in.TableID == "" || len(in.Name) == 0 || len(in.Name) > 100 || len(in.Phone) == 0 || len(in.Phone) > 30 || in.Guests < 1 || in.Guests > 100 {
			fail(w, 400, "Enter valid reservation details")
			return
		}
		in.ReservationTime = when.UTC().Format(time.RFC3339)
	}
	if in.Action == "urge" && in.TicketID == "" {
		fail(w, 400, "Select a kitchen ticket")
		return
	}
	if in.Action == "cancel" && (in.ItemID == "" || len(in.Reason) == 0 || len(in.Reason) > 500) {
		fail(w, 400, "Select an item and provide a reason")
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
	endpoint := "/station/dining/" + in.Action
	var oldHash, oldBody string
	e = tx.QueryRow("SELECT request_hash,response_body FROM idempotency_keys WHERE organization_id=? AND key=? AND endpoint=?", id.OrganizationID, in.Key, endpoint).Scan(&oldHash, &oldBody)
	if e == nil {
		if oldHash != hash {
			fail(w, 409, "Retry key already used")
			return
		}
		var value map[string]any
		if json.Unmarshal([]byte(oldBody), &value) != nil {
			fail(w, 500, "Invalid retry result")
			return
		}
		ok(w, value)
		return
	}
	if !errors.Is(e, sql.ErrNoRows) {
		fail(w, 503, "Cannot read retry state")
		return
	}
	entity := ""
	result := map[string]any{}
	switch in.Action {
	case "reserve":
		var location string
		var capacity int
		e = tx.QueryRow("SELECT location_id,capacity FROM dining_tables WHERE organization_id=? AND id=?", id.OrganizationID, in.TableID).Scan(&location, &capacity)
		if errors.Is(e, sql.ErrNoRows) {
			fail(w, 404, "Table not found")
			return
		}
		if e != nil {
			fail(w, 503, "Cannot read table")
			return
		}
		if in.Guests > capacity {
			fail(w, 409, "Table capacity exceeded")
			return
		}
		var conflicts int
		e = tx.QueryRow("SELECT count(*) FROM dining_reservations WHERE organization_id=? AND table_id=? AND status='confirmed' AND julianday(reservation_time)<julianday(?,'+90 minutes') AND julianday(reservation_time,'+90 minutes')>julianday(?)", id.OrganizationID, in.TableID, in.ReservationTime, in.ReservationTime).Scan(&conflicts)
		if e != nil {
			fail(w, 503, "Cannot check reservations")
			return
		}
		if conflicts > 0 {
			fail(w, 409, "Table already reserved during this 90-minute period")
			return
		}
		entity = "reservation_" + token()
		_, e = tx.Exec("INSERT INTO dining_reservations(id,organization_id,location_id,table_id,customer_name,customer_phone,guest_count,reservation_time,status) VALUES(?,?,?,?,?,?,?,?,'confirmed')", entity, id.OrganizationID, location, in.TableID, in.Name, in.Phone, in.Guests, in.ReservationTime)
		result["reservationId"] = entity
	case "urge":
		entity = in.TicketID
		res, err := tx.Exec("UPDATE dining_kitchen_tickets SET urgent_flag=1 WHERE organization_id=? AND id=? AND status!='served' AND EXISTS (SELECT 1 FROM dining_order_items i WHERE i.organization_id=dining_kitchen_tickets.organization_id AND i.id=dining_kitchen_tickets.order_item_id AND i.status!='cancelled')", id.OrganizationID, entity)
		e = err
		if e == nil {
			n, err := res.RowsAffected()
			e = err
			if e == nil && n != 1 {
				fail(w, 409, "Ticket unavailable or already served")
				return
			}
		}
		result["urgent"] = true
	case "cancel":
		entity = in.ItemID
		var state, sessionState, orderType, orderState string
		e = tx.QueryRow("SELECT i.status,COALESCE(s.status,''),o.order_type,o.status FROM dining_order_items i JOIN dining_orders o ON o.id=i.order_id AND o.organization_id=i.organization_id LEFT JOIN dining_table_sessions s ON s.id=o.session_id AND s.organization_id=o.organization_id WHERE i.organization_id=? AND i.id=?", id.OrganizationID, entity).Scan(&state, &sessionState, &orderType, &orderState)
		if errors.Is(e, sql.ErrNoRows) {
			fail(w, 404, "Order item not found")
			return
		}
		if e != nil {
			fail(w, 503, "Cannot read order item")
			return
		}
		if state == "cancelled" || orderType != "dine_in" || sessionState != "active" || orderState != "placed" {
			fail(w, 409, "Item cannot be voided after settlement or for takeout")
			return
		}
		if state != "pending" && g.Role != "admin" {
			fail(w, 403, "Manager approval required after preparation starts")
			return
		}
		_, e = tx.Exec("UPDATE dining_order_items SET status='cancelled',cancelled_reason=? WHERE organization_id=? AND id=? AND status=?", in.Reason, id.OrganizationID, entity, state)
		if e == nil {
			_, e = tx.Exec("UPDATE dining_kitchen_tickets SET status='served' WHERE organization_id=? AND order_item_id=?", id.OrganizationID, entity)
		}
		result["cancelledItemId"] = entity
	}
	if e != nil {
		fail(w, 503, "Cannot save dining operation")
		return
	}
	encoded, _ := json.Marshal(result)
	_, e = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", "idem_"+token(), id.OrganizationID, in.Key, endpoint, hash, string(encoded))
	if e == nil {
		_, e = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,after_value,reason) VALUES(?,?,?,?,?,'dining',?,?,?)", "audit_"+token(), id.OrganizationID, id.UserID, g.Role, "dining."+in.Action, entity, string(encoded), in.Reason)
	}
	if e != nil {
		fail(w, 503, "Cannot record dining operation")
		return
	}
	if tx.Commit() != nil {
		fail(w, 503, "Cannot commit dining operation")
		return
	}
	ok(w, result)
}
