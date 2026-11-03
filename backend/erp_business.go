package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type erpTransfer struct {
	Action         string `json:"action"`
	ItemID         string `json:"itemId"`
	From           string `json:"fromWarehouseId"`
	To             string `json:"toWarehouseId"`
	Quantity       int    `json:"quantity"`
	IdempotencyKey string `json:"idempotencyKey"`
}

func (a *App) erpBusiness(w http.ResponseWriter, r *http.Request, id *Identity, grant *Grant) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Use POST")
		return
	}
	if grant.Role == "readonly" {
		fail(w, 403, "A write-enabled role is required")
		return
	}
	var in erpTransfer
	if body(r, &in) != nil || in.Action != "transfer" || in.ItemID == "" || in.From == "" || in.To == "" || in.From == in.To || len(in.ItemID) > 256 || len(in.From) > 256 || len(in.To) > 256 || len(in.IdempotencyKey) < 8 || len(in.IdempotencyKey) > 128 || in.Quantity < 1 || in.Quantity > 1000000 {
		fail(w, 400, "Select distinct warehouses, an item, quantity and retry key")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, 503, "Inventory service unavailable")
		return
	}
	defer tx.Rollback()
	raw, _ := json.Marshal(in)
	fingerprint := digest(id.UserID + "\x00" + string(raw))
	const endpoint = "/station/erp/transfer"
	var previousHash, previousBody string
	e = tx.QueryRow("SELECT request_hash,response_body FROM idempotency_keys WHERE organization_id=? AND key=? AND endpoint=?", id.OrganizationID, in.IdempotencyKey, endpoint).Scan(&previousHash, &previousBody)
	if e == nil {
		if previousHash != fingerprint {
			fail(w, 409, "Retry key was used for a different request")
			return
		}
		var value map[string]any
		if json.Unmarshal([]byte(previousBody), &value) != nil {
			fail(w, 500, "Invalid stored result")
			return
		}
		ok(w, value)
		return
	}
	if !errors.Is(e, sql.ErrNoRows) {
		fail(w, 503, "Cannot read retry state")
		return
	}
	var active int
	if e = tx.QueryRow("SELECT count(*) FROM erp_items WHERE id=? AND organization_id=? AND is_active=1", in.ItemID, id.OrganizationID).Scan(&active); e != nil {
		fail(w, 503, "Cannot validate item")
		return
	}
	if active != 1 {
		fail(w, 404, "Active item not found")
		return
	}
	if e = tx.QueryRow("SELECT count(*) FROM erp_warehouses WHERE organization_id=? AND is_active=1 AND id IN (?,?)", id.OrganizationID, in.From, in.To).Scan(&active); e != nil {
		fail(w, 503, "Cannot validate warehouses")
		return
	}
	if active != 2 {
		fail(w, 404, "Active warehouses not found")
		return
	}
	var source, destination, cost int64
	e = tx.QueryRow("SELECT balance_after,unit_cost FROM erp_stock_ledger WHERE organization_id=? AND item_id=? AND warehouse_id=? ORDER BY rowid DESC LIMIT 1", id.OrganizationID, in.ItemID, in.From).Scan(&source, &cost)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		fail(w, 503, "Cannot read source inventory")
		return
	}
	if source < int64(in.Quantity) {
		fail(w, 409, "Insufficient source inventory")
		return
	}
	if cost < 0 || cost > 1000000000 {
		fail(w, 409, "Invalid source unit cost")
		return
	}
	e = tx.QueryRow("SELECT balance_after FROM erp_stock_ledger WHERE organization_id=? AND item_id=? AND warehouse_id=? ORDER BY rowid DESC LIMIT 1", id.OrganizationID, in.ItemID, in.To).Scan(&destination)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		fail(w, 503, "Cannot read destination inventory")
		return
	}
	ref := "TR-" + strings.ToUpper(token()[:12])
	value := cost * int64(in.Quantity)
	_, e = tx.Exec("INSERT INTO erp_stock_ledger(id,organization_id,item_id,warehouse_id,change_type,quantity_change,balance_after,unit_cost,total_value,reference_doc) VALUES(?,?,?,?,'transfer_out',?,?,?,?,?)", "stock_"+token(), id.OrganizationID, in.ItemID, in.From, -in.Quantity, source-int64(in.Quantity), cost, -value, ref)
	if e != nil {
		fail(w, 409, "Source inventory changed; refresh and retry")
		return
	}
	_, e = tx.Exec("INSERT INTO erp_stock_ledger(id,organization_id,item_id,warehouse_id,change_type,quantity_change,balance_after,unit_cost,total_value,reference_doc) VALUES(?,?,?,?,'transfer_in',?,?,?,?,?)", "stock_"+token(), id.OrganizationID, in.ItemID, in.To, in.Quantity, destination+int64(in.Quantity), cost, value, ref)
	if e != nil {
		fail(w, 409, "Destination inventory changed; refresh and retry")
		return
	}
	result := map[string]any{"transferRef": ref, "sourceBalance": source - int64(in.Quantity), "destinationBalance": destination + int64(in.Quantity), "quantity": in.Quantity}
	encoded, _ := json.Marshal(result)
	if _, e = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", "idem_"+token(), id.OrganizationID, in.IdempotencyKey, endpoint, fingerprint, string(encoded)); e != nil {
		fail(w, 503, "Unable to save retry state")
		return
	}
	if _, e = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,after_value) VALUES(?,?,?,?,'erp.transfer','erp_item',?,?)", "audit_"+token(), id.OrganizationID, id.UserID, grant.Role, in.ItemID, string(encoded)); e != nil {
		fail(w, 503, "Unable to record inventory audit")
		return
	}
	if e = tx.Commit(); e != nil {
		fail(w, 503, "Inventory transfer failed")
		return
	}
	ok(w, result)
}
