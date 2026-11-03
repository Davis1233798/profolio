package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"time"
)

type mesERPBackfillRequest struct {
	ReceiptID string `json:"receiptId"`
	Key       string `json:"idempotencyKey"`
}

func (a *App) backfillMESReceipt(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Use POST")
		return
	}
	if g.Role != "admin" || g.Scope != "back" {
		fail(w, 403, "Back-office administrator required")
		return
	}
	var in mesERPBackfillRequest
	if body(r, &in) != nil || len(in.ReceiptID) < 1 || len(in.ReceiptID) > 256 || len(in.Key) < 8 || len(in.Key) > 128 {
		fail(w, 400, "Valid receipt and retry key required")
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
	const endpoint = "/station/erp/mes-receipt-backfill"
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
	var batch, product, createdAt string
	var quantity int64
	err = tx.QueryRow(`SELECT b.id,wo.product_id,r.quantity,r.created_at FROM mes_finished_goods_receipts r JOIN mes_finished_goods_batches b ON b.organization_id=r.organization_id AND b.id=r.batch_id JOIN mes_work_orders wo ON wo.organization_id=b.organization_id AND wo.id=b.work_order_id JOIN mes_products p ON p.organization_id=wo.organization_id AND p.id=wo.product_id JOIN mes_finished_goods_inventory inv ON inv.organization_id=b.organization_id AND inv.batch_id=b.id AND inv.quantity_on_hand=r.quantity WHERE r.organization_id=? AND r.id=? AND b.status='received' AND r.quantity=b.quantity AND r.quantity BETWEEN 1 AND 1000000`, id.OrganizationID, in.ReceiptID).Scan(&batch, &product, &quantity, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "Eligible MES receipt not found")
		return
	}
	if err != nil {
		fail(w, 503, "Cannot inspect MES receipt")
		return
	}
	created, parseErr := time.Parse(time.RFC3339Nano, createdAt)
	if parseErr != nil {
		created, parseErr = time.Parse("2006-01-02 15:04:05", createdAt)
	}
	if parseErr != nil {
		fail(w, 409, "Invalid historical receipt time")
		return
	}
	eventID := "mes.received:" + in.ReceiptID
	var exists int
	if err = tx.QueryRow("SELECT count(*) FROM outbox_events WHERE id=? OR (organization_id=? AND event_type='mes.finished_goods.received' AND json_valid(payload) AND json_extract(payload,'$.sourceReceiptId')=?)", eventID, id.OrganizationID, in.ReceiptID).Scan(&exists); err != nil {
		fail(w, 503, "Cannot inspect existing event")
		return
	}
	if exists != 0 {
		fail(w, 409, "Receipt event already exists")
		return
	}
	event, _ := json.Marshal(mesReceiptEvent{EventID: eventID, SchemaVersion: 1, OrganizationID: id.OrganizationID, SourceReceiptID: in.ReceiptID, BatchID: batch, ProductID: product, Quantity: quantity, OccurredAt: created.UTC().Format(time.RFC3339Nano)})
	_, err = tx.Exec("INSERT INTO outbox_events(id,organization_id,event_type,payload) VALUES(?,?,'mes.finished_goods.received',?)", eventID, id.OrganizationID, string(event))
	result := map[string]any{"eventId": eventID}
	encoded, _ := json.Marshal(result)
	if err == nil {
		_, err = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", "idem_"+token(), id.OrganizationID, in.Key, endpoint, hash, string(encoded))
	}
	if err == nil {
		_, err = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,after_value) VALUES(?,?,?,?,?,'mes_receipt',?,?)", "audit_"+token(), id.OrganizationID, id.UserID, g.Role, "erp.mes.backfill", in.ReceiptID, string(encoded))
	}
	if err != nil {
		fail(w, 503, "Cannot backfill receipt event")
		return
	}
	if err = tx.Commit(); err != nil {
		fail(w, 503, "Cannot commit receipt event")
		return
	}
	ok(w, result)
}
