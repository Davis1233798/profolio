package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type erpCountRequest struct {
	ItemID      string `json:"itemId"`
	WarehouseID string `json:"warehouseId"`
	Expected    int64  `json:"expectedQuantity"`
	Counted     int64  `json:"countedQuantity"`
	Reason      string `json:"reason"`
	Key         string `json:"idempotencyKey"`
}

func (a *App) erpStockCount(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Use POST")
		return
	}
	if g.Role != "admin" || g.Scope != "back" {
		fail(w, 403, "Administrator back-office access required")
		return
	}
	var in erpCountRequest
	if body(r, &in) != nil {
		fail(w, 400, "Invalid stock count")
		return
	}
	in.Reason = strings.TrimSpace(in.Reason)
	if in.ItemID == "" || len(in.ItemID) > 256 || in.WarehouseID == "" || len(in.WarehouseID) > 256 || in.Expected < 0 || in.Expected > 1000000000 || in.Counted < 0 || in.Counted > 1000000000 || in.Reason == "" || len(in.Reason) > 500 || len(in.Key) < 8 || len(in.Key) > 128 {
		fail(w, 400, "Enter valid stock count details")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, 503, "Inventory unavailable")
		return
	}
	defer tx.Rollback()
	raw, _ := json.Marshal(in)
	hash := digest(id.UserID + "\x00" + string(raw))
	const endpoint = "/station/erp/stock-count"
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
	e = tx.QueryRow("SELECT count(*) FROM erp_items i JOIN erp_warehouses w ON w.organization_id=i.organization_id WHERE i.organization_id=? AND i.id=? AND w.id=? AND i.is_active=1 AND w.is_active=1", id.OrganizationID, in.ItemID, in.WarehouseID).Scan(&active)
	if e != nil {
		fail(w, 503, "Cannot validate inventory")
		return
	}
	if active != 1 {
		fail(w, 404, "Active item or warehouse not found")
		return
	}
	var balance int64
	e = tx.QueryRow("SELECT balance_after FROM erp_stock_ledger WHERE organization_id=? AND item_id=? AND warehouse_id=? ORDER BY rowid DESC LIMIT 1", id.OrganizationID, in.ItemID, in.WarehouseID).Scan(&balance)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		fail(w, 503, "Cannot read inventory")
		return
	}
	if balance != in.Expected {
		fail(w, 409, "Inventory changed; refresh before counting")
		return
	}
	delta := in.Counted - balance
	if delta == 0 {
		fail(w, 409, "Count matches inventory")
		return
	}
	var costID string
	var quantity, cost int64
	e = tx.QueryRow("SELECT id,total_quantity,total_cost FROM erp_item_costing WHERE organization_id=? AND item_id=?", id.OrganizationID, in.ItemID).Scan(&costID, &quantity, &cost)
	if e != nil || quantity <= 0 || quantity > 1000000000 || cost < 0 || cost > 1000000000000000 || quantity+delta < 0 || quantity+delta > 1000000000 {
		fail(w, 409, "A valid existing item cost is required")
		return
	}
	var value int64
	if delta < 0 {
		n := -delta
		value = -((cost/quantity)*n + ((cost%quantity)*n+quantity/2)/quantity)
	} else {
		value = (cost/quantity)*delta + ((cost%quantity)*delta+quantity/2)/quantity
	}
	newQuantity, newCost := quantity+delta, cost+value
	average := int64(0)
	if newQuantity > 0 {
		average = (newCost + newQuantity/2) / newQuantity
	}
	ref := "COUNT-" + strings.ToUpper(token()[:12])
	unit := value / delta
	_, e = tx.Exec("INSERT INTO erp_stock_ledger(id,organization_id,item_id,warehouse_id,change_type,quantity_change,balance_after,unit_cost,total_value,reference_doc) VALUES(?,?,?,?,'adjustment',?,?,?,?,?)", "stock_"+token(), id.OrganizationID, in.ItemID, in.WarehouseID, delta, in.Counted, unit, value, ref)
	if e == nil {
		_, e = tx.Exec("UPDATE erp_item_costing SET total_quantity=?,total_cost=?,moving_average_cost=?,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND id=?", newQuantity, newCost, average, id.OrganizationID, costID)
	}
	result := map[string]any{"referenceDoc": ref, "balanceAfter": in.Counted, "delta": delta}
	encoded, _ := json.Marshal(result)
	if e == nil {
		_, e = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", "idem_"+token(), id.OrganizationID, in.Key, endpoint, hash, string(encoded))
	}
	if e == nil {
		_, e = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,before_value,after_value,reason) VALUES(?,?,?,?,'erp.stock_count','erp_item',?,?,?,?)", "audit_"+token(), id.OrganizationID, id.UserID, g.Role, in.ItemID, string(raw), string(encoded), in.Reason)
	}
	if e != nil {
		fail(w, 503, "Cannot record stock count")
		return
	}
	if tx.Commit() != nil {
		fail(w, 503, "Cannot commit stock count")
		return
	}
	ok(w, result)
}
