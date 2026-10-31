package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type posCartLine struct {
	ItemID   string `json:"itemId"`
	Quantity int64  `json:"quantity"`
}
type posCartRequest struct {
	Action   string        `json:"action"`
	ShiftID  string        `json:"shiftId"`
	CartID   string        `json:"cartId"`
	CartName string        `json:"cartName"`
	Lines    []posCartLine `json:"lines"`
	Tender   int64         `json:"tender"`
	Key      string        `json:"idempotencyKey"`
}

func (a *App) posCart(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Use POST")
		return
	}
	if g.Role == "readonly" {
		fail(w, 403, "A write-enabled role is required")
		return
	}
	var in posCartRequest
	if body(r, &in) != nil || len(in.Key) < 8 || len(in.Key) > 128 || in.ShiftID == "" || len(in.ShiftID) > 256 || len(in.CartID) > 256 || in.Tender < 0 || in.Tender > 1000000000 || (in.Action != "hold" && in.Action != "claim" && in.Action != "release" && in.Action != "checkout") {
		fail(w, 400, "Invalid cart request")
		return
	}
	in.CartName = strings.TrimSpace(in.CartName)
	if in.Action == "hold" && (in.CartName == "" || len(in.CartName) > 100 || len(in.Lines) == 0 || len(in.Lines) > 100) {
		fail(w, 400, "Enter a cart name and items")
		return
	}
	if (in.Action == "claim" || in.Action == "release") && in.CartID == "" {
		fail(w, 400, "Select a cart")
		return
	}
	if in.Action == "checkout" && in.CartID == "" && (len(in.Lines) == 0 || len(in.Lines) > 100) {
		fail(w, 400, "Add items to the sale")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, 503, "POS unavailable")
		return
	}
	defer tx.Rollback()
	raw, _ := json.Marshal(in)
	hash := digest(id.UserID + "\x00" + string(raw))
	endpoint := "/station/pos/cart/" + in.Action
	var oldHash, oldBody string
	e = tx.QueryRow("SELECT request_hash,response_body FROM idempotency_keys WHERE organization_id=? AND key=? AND endpoint=?", id.OrganizationID, in.Key, endpoint).Scan(&oldHash, &oldBody)
	if e == nil {
		if hash != oldHash {
			fail(w, 409, "Retry key already used")
			return
		}
		var result map[string]any
		if json.Unmarshal([]byte(oldBody), &result) != nil {
			fail(w, 500, "Invalid retry result")
			return
		}
		ok(w, result)
		return
	}
	if !errors.Is(e, sql.ErrNoRows) {
		fail(w, 503, "Cannot read retry state")
		return
	}
	var store, register, cashier, status string
	e = tx.QueryRow("SELECT store_id,register_id,cashier_id,status FROM pos_shifts WHERE organization_id=? AND id=?", id.OrganizationID, in.ShiftID).Scan(&store, &register, &cashier, &status)
	if errors.Is(e, sql.ErrNoRows) {
		fail(w, 404, "Shift not found")
		return
	}
	if e != nil {
		fail(w, 503, "Cannot read shift")
		return
	}
	if status != "open" {
		fail(w, 409, "Shift is not open")
		return
	}
	if cashier != id.UserID && g.Role != "admin" {
		fail(w, 403, "Cannot use another cashier's shift")
		return
	}
	entity := ""
	result := map[string]any{}
	lines := in.Lines
	if in.Action == "claim" || in.Action == "release" || (in.Action == "checkout" && in.CartID != "") {
		var cartStore, cartStatus, locked, stored string
		e = tx.QueryRow("SELECT store_id,status,COALESCE(locked_by,''),items_json FROM pos_held_carts WHERE organization_id=? AND id=?", id.OrganizationID, in.CartID).Scan(&cartStore, &cartStatus, &locked, &stored)
		if errors.Is(e, sql.ErrNoRows) {
			fail(w, 404, "Cart not found")
			return
		}
		if e != nil {
			fail(w, 503, "Cannot read cart")
			return
		}
		if cartStore != store {
			fail(w, 403, "Cart belongs to another store")
			return
		}
		entity = in.CartID
		if in.Action == "claim" {
			if cartStatus != "held" {
				fail(w, 409, "Cart has already been claimed")
				return
			}
			_, e = tx.Exec("UPDATE pos_held_carts SET status='retrieved',locked_by=? WHERE organization_id=? AND id=? AND status='held'", id.UserID, id.OrganizationID, in.CartID)
			result = map[string]any{"cartId": entity, "status": "retrieved"}
		}
		if in.Action == "release" {
			if cartStatus != "retrieved" || locked != id.UserID {
				fail(w, 409, "Only the claimant can release this cart")
				return
			}
			_, e = tx.Exec("UPDATE pos_held_carts SET status='held',locked_by=NULL WHERE organization_id=? AND id=? AND status='retrieved' AND locked_by=?", id.OrganizationID, in.CartID, id.UserID)
			result = map[string]any{"cartId": entity, "status": "held"}
		}
		if in.Action == "checkout" {
			if cartStatus != "retrieved" || locked != id.UserID {
				fail(w, 409, "Claim this cart before checkout")
				return
			}
			if json.Unmarshal([]byte(stored), &lines) != nil {
				fail(w, 409, "Invalid stored cart")
				return
			}
		}
	}
	if in.Action == "hold" || in.Action == "checkout" {
		if len(lines) == 0 || len(lines) > 100 {
			fail(w, 400, "Cart must contain 1 to 100 items")
			return
		}
		seen := map[string]bool{}
		type resolved struct {
			posCartLine
			barcode, name string
			price         int64
		}
		resolvedLines := []resolved{}
		var total int64
		for _, line := range lines {
			if line.ItemID == "" || len(line.ItemID) > 256 || line.Quantity < 1 || line.Quantity > 1000 || seen[line.ItemID] {
				fail(w, 400, "Invalid or duplicate cart item")
				return
			}
			seen[line.ItemID] = true
			var barcode, name string
			var price, stock int64
			e = tx.QueryRow("SELECT barcode,name,price,stock_quantity FROM pos_catalog_items WHERE organization_id=? AND id=? AND is_active=1", id.OrganizationID, line.ItemID).Scan(&barcode, &name, &price, &stock)
			if errors.Is(e, sql.ErrNoRows) {
				fail(w, 404, "Active product not found")
				return
			}
			if e != nil {
				fail(w, 503, "Cannot read product")
				return
			}
			if price < 0 || price > 1000000 || total > 1000000000-price*line.Quantity {
				fail(w, 400, "Invalid cart total")
				return
			}
			if in.Action == "checkout" && stock < line.Quantity {
				fail(w, 409, "Insufficient stock")
				return
			}
			total += price * line.Quantity
			resolvedLines = append(resolvedLines, resolved{line, barcode, name, price})
		}
		if in.Action == "hold" {
			encoded, _ := json.Marshal(lines)
			entity = "cart_" + token()
			_, e = tx.Exec("INSERT INTO pos_held_carts(id,organization_id,store_id,cart_name,items_json,status) VALUES(?,?,?,?,?,'held')", entity, id.OrganizationID, store, in.CartName, string(encoded))
			result = map[string]any{"cartId": entity, "status": "held"}
		} else {
			if in.Tender < total {
				fail(w, 400, "Cash tender is less than the total")
				return
			}
			entity = "sale_" + token()
			receipt := "POS-" + strings.ToUpper(token()[:12])
			_, e = tx.Exec("INSERT INTO pos_sales(id,organization_id,receipt_number,store_id,register_id,shift_id,cashier_id,subtotal,total_amount,tender_amount,change_amount,payment_method,status,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,'cash','completed',?)", entity, id.OrganizationID, receipt, store, register, in.ShiftID, id.UserID, total, total, in.Tender, in.Tender-total, in.Key)
			for _, line := range resolvedLines {
				if e != nil {
					break
				}
				var updated sql.Result
				updated, e = tx.Exec("UPDATE pos_catalog_items SET stock_quantity=stock_quantity-? WHERE organization_id=? AND id=? AND stock_quantity>=?", line.Quantity, id.OrganizationID, line.ItemID, line.Quantity)
				if e == nil {
					var n int64
					n, e = updated.RowsAffected()
					if e == nil && n != 1 {
						fail(w, 409, "Stock changed; refresh and retry")
						return
					}
				}
				if e == nil {
					_, e = tx.Exec("INSERT INTO pos_sale_lines(id,organization_id,sale_id,item_id,barcode,name,unit_price,quantity,line_total) VALUES(?,?,?,?,?,?,?,?,?)", "sale_line_"+token(), id.OrganizationID, entity, line.ItemID, line.barcode, line.name, line.price, line.Quantity, line.price*line.Quantity)
				}
			}
			if e == nil && in.CartID != "" {
				_, e = tx.Exec("UPDATE pos_held_carts SET status='completed' WHERE organization_id=? AND id=? AND status='retrieved' AND locked_by=?", id.OrganizationID, in.CartID, id.UserID)
			}
			result = map[string]any{"saleId": entity, "receiptNumber": receipt, "totalAmount": total, "changeAmount": in.Tender - total}
		}
	}
	if e != nil {
		fail(w, 503, "Cannot save cart operation")
		return
	}
	encoded, _ := json.Marshal(result)
	_, e = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", "idem_"+token(), id.OrganizationID, in.Key, endpoint, hash, string(encoded))
	if e == nil {
		_, e = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,after_value) VALUES(?,?,?,?,?,'pos_cart',?,?)", "audit_"+token(), id.OrganizationID, id.UserID, g.Role, "pos.cart."+in.Action, entity, string(encoded))
	}
	if e != nil {
		fail(w, 503, "Cannot record cart operation")
		return
	}
	if tx.Commit() != nil {
		fail(w, 503, "Cannot commit cart operation")
		return
	}
	ok(w, result)
}
