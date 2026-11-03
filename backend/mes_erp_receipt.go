package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type mesERPReceiptRequest struct {
	EventID   string `json:"eventId"`
	MappingID string `json:"mappingId"`
	UnitCost  int64  `json:"unitCost"`
	Reason    string `json:"reason"`
	Key       string `json:"idempotencyKey"`
}
type mesReceiptEvent struct {
	EventID         string `json:"eventId"`
	SchemaVersion   int    `json:"schemaVersion"`
	OrganizationID  string `json:"organizationId"`
	SourceReceiptID string `json:"sourceReceiptId"`
	BatchID         string `json:"batchId"`
	ProductID       string `json:"mesProductId"`
	Quantity        int64  `json:"quantity"`
	OccurredAt      string `json:"occurredAt"`
}

func (a *App) postMESERPReceipt(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Use POST")
		return
	}
	if g.Role != "admin" || g.Scope != "back" {
		fail(w, 403, "Back-office administrator required")
		return
	}
	var in mesERPReceiptRequest
	if body(r, &in) != nil {
		fail(w, 400, "Invalid receipt posting")
		return
	}
	in.Reason = strings.TrimSpace(in.Reason)
	if len(in.EventID) < 1 || len(in.EventID) > 256 || len(in.MappingID) < 1 || len(in.MappingID) > 256 || len(in.Key) < 8 || len(in.Key) > 128 || in.UnitCost < 0 || in.UnitCost > 1000000000 || len(in.Reason) < 1 || len(in.Reason) > 500 {
		fail(w, 400, "Valid event, mapping and cost reason required")
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		fail(w, 503, "ERP unavailable")
		return
	}
	defer tx.Rollback()
	for _, site := range []string{"mes", "erp"} {
		var n int
		err = tx.QueryRow(`SELECT count(*) FROM station_accounts a JOIN station_grants g ON g.user_id=a.user_id WHERE a.organization_id=? AND a.user_id=? AND a.disabled=0 AND g.site=? AND g.enabled=1 AND g.scope='back' AND g.role='admin'`, id.OrganizationID, id.UserID, site).Scan(&n)
		if err != nil {
			fail(w, 503, "Cannot verify permissions")
			return
		}
		if n != 1 {
			fail(w, 403, "MES and ERP administrator access required")
			return
		}
	}
	raw, _ := json.Marshal(in)
	hash := digest(id.UserID + "\x00" + string(raw))
	const endpoint = "/station/erp/mes-receipt"
	var oldHash, oldBody string
	err = tx.QueryRow("SELECT request_hash,response_body FROM idempotency_keys WHERE organization_id=? AND key=? AND endpoint=?", id.OrganizationID, in.Key, endpoint).Scan(&oldHash, &oldBody)
	if err == nil {
		if oldHash != hash {
			fail(w, 409, "Retry key already used")
			return
		}
		var result map[string]any
		if json.Unmarshal([]byte(oldBody), &result) != nil {
			fail(w, 500, "Invalid stored result")
			return
		}
		ok(w, result)
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		fail(w, 503, "Cannot inspect retry state")
		return
	}
	var payload, status string
	err = tx.QueryRow("SELECT payload,status FROM outbox_events WHERE organization_id=? AND id=? AND event_type='mes.finished_goods.received'", id.OrganizationID, in.EventID).Scan(&payload, &status)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "MES receipt event not found")
		return
	}
	if err != nil {
		fail(w, 503, "Cannot read MES receipt event")
		return
	}
	if status != "pending" {
		fail(w, 409, "MES receipt event already processed")
		return
	}
	var event mesReceiptEvent
	if json.Unmarshal([]byte(payload), &event) != nil || event.EventID != in.EventID || event.SchemaVersion != 1 || event.OrganizationID != id.OrganizationID || event.SourceReceiptID == "" || event.BatchID == "" || event.ProductID == "" || event.Quantity < 1 || event.Quantity > 1000000 || event.OccurredAt == "" {
		fail(w, 409, "Invalid MES receipt event")
		return
	}
	var item, warehouse string
	var version int
	var match int
	err = tx.QueryRow(`SELECT m.erp_item_id,m.warehouse_id,m.version FROM mes_erp_product_mappings m JOIN mes_products p ON p.organization_id=m.organization_id AND p.id=m.mes_product_id AND p.status='active' JOIN erp_items i ON i.organization_id=m.organization_id AND i.id=m.erp_item_id AND i.is_active=1 AND i.unit=p.unit JOIN erp_warehouses wh ON wh.organization_id=m.organization_id AND wh.id=m.warehouse_id AND wh.is_active=1 WHERE m.organization_id=? AND m.id=? AND m.mes_product_id=? AND m.is_active=1`, id.OrganizationID, in.MappingID, event.ProductID).Scan(&item, &warehouse, &version)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 409, "Active matching product mapping required")
		return
	}
	if err != nil {
		fail(w, 503, "Cannot inspect mapping")
		return
	}
	err = tx.QueryRow(`SELECT count(*) FROM mes_finished_goods_receipts r JOIN mes_finished_goods_batches b ON b.organization_id=r.organization_id AND b.id=r.batch_id JOIN mes_work_orders wo ON wo.organization_id=b.organization_id AND wo.id=b.work_order_id WHERE r.organization_id=? AND r.id=? AND r.batch_id=? AND r.quantity=? AND b.status='received' AND wo.product_id=?`, id.OrganizationID, event.SourceReceiptID, event.BatchID, event.Quantity, event.ProductID).Scan(&match)
	if err != nil {
		fail(w, 503, "Cannot verify MES receipt")
		return
	}
	if match != 1 {
		fail(w, 409, "MES receipt does not match event")
		return
	}
	var balance, qty, cost int64
	var costing string
	err = tx.QueryRow("SELECT balance_after FROM erp_stock_ledger WHERE organization_id=? AND item_id=? AND warehouse_id=? ORDER BY rowid DESC LIMIT 1", id.OrganizationID, item, warehouse).Scan(&balance)
	if errors.Is(err, sql.ErrNoRows) {
		err = nil
	}
	if err != nil || balance < 0 || balance > 1000000000-event.Quantity {
		fail(w, 409, "Invalid warehouse balance")
		return
	}
	err = tx.QueryRow("SELECT id,total_quantity,total_cost FROM erp_item_costing WHERE organization_id=? AND item_id=?", id.OrganizationID, item).Scan(&costing, &qty, &cost)
	if errors.Is(err, sql.ErrNoRows) {
		err = nil
	}
	value := event.Quantity * in.UnitCost
	if err != nil || qty < 0 || qty > 1000000000-event.Quantity || cost < 0 || cost > 1000000000000000-value {
		fail(w, 409, "Invalid item costing")
		return
	}
	postingID, ledgerID := "mespost_"+token(), "stock_"+token()
	newQty, newCost := qty+event.Quantity, cost+value
	average := (newCost + newQty/2) / newQty
	_, err = tx.Exec("INSERT INTO erp_stock_ledger(id,organization_id,item_id,warehouse_id,change_type,quantity_change,balance_after,unit_cost,total_value,reference_doc) VALUES(?,?,?,?,'mes_receipt',?,?,?,?,?)", ledgerID, id.OrganizationID, item, warehouse, event.Quantity, balance+event.Quantity, in.UnitCost, value, event.SourceReceiptID)
	if err == nil && costing == "" {
		_, err = tx.Exec("INSERT INTO erp_item_costing(id,organization_id,item_id,total_quantity,total_cost,moving_average_cost) VALUES(?,?,?,?,?,?)", "cost_"+token(), id.OrganizationID, item, newQty, newCost, average)
	} else if err == nil {
		_, err = tx.Exec("UPDATE erp_item_costing SET total_quantity=?,total_cost=?,moving_average_cost=?,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND id=?", newQty, newCost, average, id.OrganizationID, costing)
	}
	if err == nil {
		_, err = tx.Exec("INSERT INTO erp_mes_receipt_postings(id,organization_id,event_id,source_receipt_id,mapping_id,mapping_version,item_id,warehouse_id,quantity,unit_cost,reason,ledger_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", postingID, id.OrganizationID, in.EventID, event.SourceReceiptID, in.MappingID, version, item, warehouse, event.Quantity, in.UnitCost, in.Reason, ledgerID)
	}
	result := map[string]any{"postingId": postingID, "ledgerId": ledgerID}
	encoded, _ := json.Marshal(result)
	if err == nil {
		_, err = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", "idem_"+token(), id.OrganizationID, in.Key, endpoint, hash, string(encoded))
	}
	if err == nil {
		_, err = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,after_value,reason) VALUES(?,?,?,?,?,'erp_mes_receipt',?,?,?)", "audit_"+token(), id.OrganizationID, id.UserID, g.Role, "erp.mes.postReceipt", postingID, string(encoded), in.Reason)
	}
	if err == nil {
		_, err = tx.Exec("UPDATE outbox_events SET status='processed' WHERE organization_id=? AND id=? AND status='pending'", id.OrganizationID, in.EventID)
	}
	if err != nil {
		fail(w, 503, "Cannot post MES receipt")
		return
	}
	if err = tx.Commit(); err != nil {
		fail(w, 503, "Cannot commit MES receipt")
		return
	}
	ok(w, result)
}
