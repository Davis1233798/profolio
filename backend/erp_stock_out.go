package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type stockOutLine struct {
	LineID   string `json:"lineId"`
	Quantity int64  `json:"quantity"`
}
type stockOutRequest struct {
	Action       string         `json:"action"`
	SalesOrderID string         `json:"salesOrderId"`
	WarehouseID  string         `json:"warehouseId"`
	ItemID       string         `json:"itemId"`
	Quantity     int64          `json:"quantity"`
	Reason       string         `json:"reason"`
	Reference    string         `json:"reference"`
	Lines        []stockOutLine `json:"lines"`
	Key          string         `json:"idempotencyKey"`
}

func (a *App) erpStockOut(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Use POST")
		return
	}
	if g.Role == "readonly" || g.Scope != "back" {
		fail(w, 403, "Write-enabled back-office access required")
		return
	}
	var in stockOutRequest
	if body(r, &in) != nil || len(in.Key) < 8 || len(in.Key) > 128 || len(in.WarehouseID) == 0 || len(in.WarehouseID) > 256 || len(in.SalesOrderID) > 256 || len(in.ItemID) > 256 || (in.Action != "return" && in.Action != "ship") {
		fail(w, 400, "Invalid stock request")
		return
	}
	in.Reason = strings.TrimSpace(in.Reason)
	in.Reference = strings.TrimSpace(in.Reference)
	if in.Action == "return" && (in.ItemID == "" || in.Quantity < 1 || in.Quantity > 1000000 || in.Reason == "" || len(in.Reason) > 500 || in.Reference == "" || len(in.Reference) > 128) {
		fail(w, 400, "Select an item, quantity, reference and reason")
		return
	}
	if in.Action == "ship" && (in.SalesOrderID == "" || len(in.Lines) == 0 || len(in.Lines) > 100) {
		fail(w, 400, "Select a sales order and shipment lines")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, 503, "Stock service unavailable")
		return
	}
	defer tx.Rollback()
	raw, _ := json.Marshal(in)
	hash := digest(id.UserID + "\x00" + string(raw))
	endpoint := "/station/erp/stock-out/" + in.Action
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
	// Remove a proportional share of total cost, preserving the remainder for subsequent issues.
	remove := func(item string, quantity int64, kind, reference string) (int64, error) {
		var balance int64
		err := tx.QueryRow("SELECT balance_after FROM erp_stock_ledger WHERE organization_id=? AND item_id=? AND warehouse_id=? ORDER BY rowid DESC LIMIT 1", id.OrganizationID, item, in.WarehouseID).Scan(&balance)
		if errors.Is(err, sql.ErrNoRows) {
			return 0, errors.New("insufficient stock")
		}
		if err != nil || balance < quantity {
			return 0, errors.New("insufficient stock")
		}
		var costID string
		var stockQty, totalCost int64
		err = tx.QueryRow("SELECT id,total_quantity,total_cost FROM erp_item_costing WHERE organization_id=? AND item_id=?", id.OrganizationID, item).Scan(&costID, &stockQty, &totalCost)
		if err != nil || stockQty < quantity || stockQty > 1000000000 || totalCost < 0 || totalCost > 1000000000000000 {
			return 0, errors.New("invalid item costing")
		}
		value := (totalCost/stockQty)*quantity + ((totalCost%stockQty)*quantity+stockQty/2)/stockQty
		unitCost := (value + quantity/2) / quantity
		newQty, newCost := stockQty-quantity, totalCost-value
		average := int64(0)
		if newQty > 0 {
			average = (newCost + newQty/2) / newQty
		}
		_, err = tx.Exec("UPDATE erp_item_costing SET total_quantity=?,total_cost=?,moving_average_cost=?,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND id=?", newQty, newCost, average, id.OrganizationID, costID)
		if err == nil {
			_, err = tx.Exec("INSERT INTO erp_stock_ledger(id,organization_id,item_id,warehouse_id,change_type,quantity_change,balance_after,unit_cost,total_value,reference_doc) VALUES(?,?,?,?,?,?,?,?,?,?)", "stock_"+token(), id.OrganizationID, item, in.WarehouseID, kind, -quantity, balance-quantity, unitCost, -value, reference)
		}
		return unitCost, err
	}
	entity := ""
	result := map[string]any{}
	if in.Action == "return" {
		e = tx.QueryRow("SELECT count(*) FROM erp_items WHERE organization_id=? AND id=? AND is_active=1", id.OrganizationID, in.ItemID).Scan(&active)
		if e != nil {
			fail(w, 503, "Cannot read item")
			return
		}
		if active != 1 {
			fail(w, 404, "Active item not found")
			return
		}
		_, e = remove(in.ItemID, in.Quantity, "purchase_return", in.Reference)
		if e != nil {
			fail(w, 409, "Insufficient stock or invalid costing")
			return
		}
		entity = in.ItemID
		result["returnedQuantity"] = in.Quantity
	} else {
		var status string
		e = tx.QueryRow("SELECT status FROM erp_sales_orders WHERE organization_id=? AND id=?", id.OrganizationID, in.SalesOrderID).Scan(&status)
		if errors.Is(e, sql.ErrNoRows) {
			fail(w, 404, "Sales order not found")
			return
		}
		if e != nil {
			fail(w, 503, "Cannot read sales order")
			return
		}
		if status == "cancelled" || status == "shipped" {
			fail(w, 409, "Sales order cannot be shipped")
			return
		}
		entity = "shipment_" + token()
		number := "SH-" + strings.ToUpper(token()[:12])
		_, e = tx.Exec("INSERT INTO erp_shipments(id,organization_id,shipment_number,so_id,warehouse_id,status) VALUES(?,?,?,?,?,'completed')", entity, id.OrganizationID, number, in.SalesOrderID, in.WarehouseID)
		seen := map[string]bool{}
		for _, line := range in.Lines {
			if e != nil {
				break
			}
			if line.LineID == "" || len(line.LineID) > 256 || line.Quantity < 1 || line.Quantity > 1000000 || seen[line.LineID] {
				fail(w, 400, "Invalid or duplicate shipment line")
				return
			}
			seen[line.LineID] = true
			var item string
			var ordered, shipped int64
			e = tx.QueryRow("SELECT item_id,quantity,shipped_quantity FROM erp_sales_order_lines WHERE organization_id=? AND so_id=? AND id=?", id.OrganizationID, in.SalesOrderID, line.LineID).Scan(&item, &ordered, &shipped)
			if errors.Is(e, sql.ErrNoRows) {
				fail(w, 404, "Sales line not found")
				return
			}
			if e != nil {
				fail(w, 503, "Cannot read sales line")
				return
			}
			if ordered < 0 || shipped < 0 || shipped > ordered || line.Quantity > ordered-shipped {
				fail(w, 409, "Shipment exceeds remaining order quantity")
				return
			}
			unitCost, err := remove(item, line.Quantity, "sales_shipment", number)
			if err != nil {
				fail(w, 409, "Insufficient stock or invalid costing")
				return
			}
			_, e = tx.Exec("UPDATE erp_sales_order_lines SET shipped_quantity=? WHERE organization_id=? AND so_id=? AND id=? AND shipped_quantity=?", shipped+line.Quantity, id.OrganizationID, in.SalesOrderID, line.LineID, shipped)
			if e == nil {
				_, e = tx.Exec("INSERT INTO erp_shipment_lines(id,organization_id,shipment_id,item_id,quantity,unit_cost) VALUES(?,?,?,?,?,?)", "shipmentline_"+token(), id.OrganizationID, entity, item, line.Quantity, unitCost)
			}
		}
		if e == nil {
			var remaining int
			e = tx.QueryRow("SELECT count(*) FROM erp_sales_order_lines WHERE organization_id=? AND so_id=? AND shipped_quantity<quantity", id.OrganizationID, in.SalesOrderID).Scan(&remaining)
			next := "partially_shipped"
			if remaining == 0 {
				next = "shipped"
			}
			if e == nil {
				_, e = tx.Exec("UPDATE erp_sales_orders SET status=? WHERE organization_id=? AND id=?", next, id.OrganizationID, in.SalesOrderID)
			}
			result = map[string]any{"shipmentNumber": number, "orderStatus": next}
		}
	}
	if e != nil {
		fail(w, 503, "Cannot save stock transaction")
		return
	}
	encoded, _ := json.Marshal(result)
	_, e = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", "idem_"+token(), id.OrganizationID, in.Key, endpoint, hash, string(encoded))
	if e == nil {
		_, e = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,after_value,reason) VALUES(?,?,?,?,?,'erp_stock',?,?,?)", "audit_"+token(), id.OrganizationID, id.UserID, g.Role, "erp."+in.Action, entity, string(encoded), in.Reason)
	}
	if e != nil {
		fail(w, 503, "Cannot record stock transaction")
		return
	}
	if tx.Commit() != nil {
		fail(w, 503, "Cannot commit stock transaction")
		return
	}
	ok(w, result)
}
