package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type purchaseLine struct {
	LineID   string `json:"lineId"`
	Quantity int64  `json:"quantity"`
	IsBoxes  bool   `json:"isBoxes"`
}
type purchaseRequest struct {
	Action      string         `json:"action"`
	POID        string         `json:"poId"`
	WarehouseID string         `json:"warehouseId"`
	Reason      string         `json:"reason"`
	Lines       []purchaseLine `json:"lines"`
	Key         string         `json:"idempotencyKey"`
}

func (a *App) erpPurchasing(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Use POST")
		return
	}
	if g.Role == "readonly" || g.Scope != "back" {
		fail(w, 403, "Write-enabled back-office access required")
		return
	}
	var in purchaseRequest
	if body(r, &in) != nil || len(in.Key) < 8 || len(in.Key) > 128 || len(in.POID) == 0 || len(in.POID) > 256 || len(in.WarehouseID) > 256 || (in.Action != "approve" && in.Action != "reject" && in.Action != "receive") {
		fail(w, 400, "Invalid purchase request")
		return
	}
	in.Reason = strings.TrimSpace(in.Reason)
	if in.Action != "receive" {
		if g.Role != "admin" {
			fail(w, 403, "Manager role required")
			return
		}
		if len(in.Reason) > 500 || (in.Action == "reject" && in.Reason == "") {
			fail(w, 400, "Provide a rejection reason")
			return
		}
	} else if in.WarehouseID == "" || len(in.Lines) == 0 || len(in.Lines) > 100 {
		fail(w, 400, "Select a warehouse and receipt lines")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, 503, "Purchasing unavailable")
		return
	}
	defer tx.Rollback()
	raw, _ := json.Marshal(in)
	hash := digest(id.UserID + "\x00" + string(raw))
	endpoint := "/station/erp/purchase/" + in.Action
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
	var status string
	e = tx.QueryRow("SELECT status FROM erp_purchase_orders WHERE organization_id=? AND id=?", id.OrganizationID, in.POID).Scan(&status)
	if errors.Is(e, sql.ErrNoRows) {
		fail(w, 404, "Purchase order not found")
		return
	}
	if e != nil {
		fail(w, 503, "Cannot read purchase order")
		return
	}
	result := map[string]any{}
	entity := in.POID
	if in.Action != "receive" {
		if status != "draft" && status != "submitted" {
			fail(w, 409, "Purchase order cannot be reviewed in its current state")
			return
		}
		next := "approved"
		if in.Action == "reject" {
			next = "rejected"
		}
		_, e = tx.Exec("UPDATE erp_purchase_orders SET status=?,rejected_reason=? WHERE organization_id=? AND id=? AND status=?", next, in.Reason, id.OrganizationID, in.POID, status)
		result["status"] = next
	} else {
		if status != "approved" {
			fail(w, 409, "Purchase order must be approved before receipt")
			return
		}
		var active int
		e = tx.QueryRow("SELECT count(*) FROM erp_warehouses WHERE organization_id=? AND id=? AND is_active=1", id.OrganizationID, in.WarehouseID).Scan(&active)
		if e != nil {
			fail(w, 503, "Cannot read warehouse")
			return
		}
		if active != 1 {
			fail(w, 404, "Active warehouse not found")
			return
		}
		entity = "receipt_" + token()
		number := "RC-" + strings.ToUpper(token()[:12])
		_, e = tx.Exec("INSERT INTO erp_receipts(id,organization_id,receipt_number,po_id,warehouse_id,status) VALUES(?,?,?,?,?,'completed')", entity, id.OrganizationID, number, in.POID, in.WarehouseID)
		seen := map[string]bool{}
		for _, line := range in.Lines {
			if e != nil {
				break
			}
			if len(line.LineID) == 0 || len(line.LineID) > 256 || line.Quantity < 1 || line.Quantity > 1000000 || seen[line.LineID] {
				fail(w, 400, "Invalid or duplicate receipt line")
				return
			}
			seen[line.LineID] = true
			var item string
			var ordered, received, price, ratio int64
			e = tx.QueryRow("SELECT l.item_id,l.quantity,l.received_quantity,l.unit_price,i.box_conversion_ratio FROM erp_purchase_order_lines l JOIN erp_items i ON i.id=l.item_id AND i.organization_id=l.organization_id WHERE l.organization_id=? AND l.po_id=? AND l.id=? AND i.is_active=1", id.OrganizationID, in.POID, line.LineID).Scan(&item, &ordered, &received, &price, &ratio)
			if errors.Is(e, sql.ErrNoRows) {
				fail(w, 404, "Purchase line or active item not found")
				return
			}
			if e != nil {
				fail(w, 503, "Cannot read purchase line")
				return
			}
			if price < 0 || price > 1000000000 || ratio < 1 || ratio > 1000000 || ordered < 0 || received < 0 || received > ordered {
				fail(w, 409, "Invalid purchase line values")
				return
			}
			pieces := line.Quantity
			if line.IsBoxes {
				pieces *= ratio
			}
			if pieces > 1000000000 || pieces > ordered-received {
				fail(w, 409, "Receipt exceeds remaining quantity")
				return
			}
			var balance int64
			e = tx.QueryRow("SELECT balance_after FROM erp_stock_ledger WHERE organization_id=? AND item_id=? AND warehouse_id=? ORDER BY rowid DESC LIMIT 1", id.OrganizationID, item, in.WarehouseID).Scan(&balance)
			if errors.Is(e, sql.ErrNoRows) {
				e = nil
			}
			if e != nil || balance < 0 || balance > 1000000000-pieces {
				fail(w, 409, "Invalid warehouse balance")
				return
			}
			var costing string
			var qty, cost int64
			e = tx.QueryRow("SELECT id,total_quantity,total_cost FROM erp_item_costing WHERE organization_id=? AND item_id=?", id.OrganizationID, item).Scan(&costing, &qty, &cost)
			if errors.Is(e, sql.ErrNoRows) {
				e = nil
				costing = ""
			}
			if e != nil || qty < 0 || qty > 1000000000-pieces || cost < 0 || cost > 1000000000000000-pieces*price {
				fail(w, 409, "Invalid item costing")
				return
			}
			newQty, newCost := qty+pieces, cost+pieces*price
			average := (newCost + newQty/2) / newQty
			_, e = tx.Exec("UPDATE erp_purchase_order_lines SET received_quantity=? WHERE organization_id=? AND po_id=? AND id=? AND received_quantity=?", received+pieces, id.OrganizationID, in.POID, line.LineID, received)
			if e == nil {
				_, e = tx.Exec("INSERT INTO erp_receipt_lines(id,organization_id,receipt_id,item_id,quantity,unit_cost) VALUES(?,?,?,?,?,?)", "receiptline_"+token(), id.OrganizationID, entity, item, pieces, price)
			}
			if e == nil {
				_, e = tx.Exec("INSERT INTO erp_stock_ledger(id,organization_id,item_id,warehouse_id,change_type,quantity_change,balance_after,unit_cost,total_value,reference_doc) VALUES(?,?,?,?,'purchase_receipt',?,?,?,?,?)", "stock_"+token(), id.OrganizationID, item, in.WarehouseID, pieces, balance+pieces, price, pieces*price, number)
			}
			if e == nil && costing == "" {
				_, e = tx.Exec("INSERT INTO erp_item_costing(id,organization_id,item_id,total_quantity,total_cost,moving_average_cost) VALUES(?,?,?,?,?,?)", "cost_"+token(), id.OrganizationID, item, newQty, newCost, average)
			} else if e == nil {
				_, e = tx.Exec("UPDATE erp_item_costing SET total_quantity=?,total_cost=?,moving_average_cost=?,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND id=?", newQty, newCost, average, id.OrganizationID, costing)
			}
		}
		result = map[string]any{"receiptId": entity, "receiptNumber": number}
	}
	if e != nil {
		fail(w, 503, "Cannot save purchase transaction")
		return
	}
	encoded, _ := json.Marshal(result)
	_, e = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", "idem_"+token(), id.OrganizationID, in.Key, endpoint, hash, string(encoded))
	if e == nil {
		_, e = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,after_value,reason) VALUES(?,?,?,?,?,'erp_purchase',?,?,?)", "audit_"+token(), id.OrganizationID, id.UserID, g.Role, "erp.purchase."+in.Action, entity, string(encoded), in.Reason)
	}
	if e != nil {
		fail(w, 503, "Cannot record purchase transaction")
		return
	}
	if tx.Commit() != nil {
		fail(w, 503, "Cannot commit purchase transaction")
		return
	}
	ok(w, result)
}
