package main

import (
	"net/http"
	"testing"
)

func TestMESERPBackfillHistoricalReceipt(t *testing.T) {
	a := appForTest(t)
	f := prepareMESERPReceiptPostingFixture(t, a)
	var receipt string
	if err := a.db.QueryRow("SELECT json_extract(payload,'$.sourceReceiptId') FROM outbox_events WHERE organization_id=? AND id=?", f.org, f.eventID).Scan(&receipt); err != nil {
		t.Fatal(err)
	}
	if _, err := a.db.Exec("DELETE FROM outbox_events WHERE organization_id=? AND id=?", f.org, f.eventID); err != nil {
		t.Fatal(err)
	}
	input := map[string]any{"receiptId": receipt, "idempotencyKey": "historical-backfill-0001"}
	path := "/api/stations/erp/mes-receipt-backfill"
	if w := request(a, http.MethodPost, path, input, f.erpAdmin...); w.Code != http.StatusOK {
		t.Fatalf("backfill: %d %s", w.Code, w.Body.String())
	}
	if w := request(a, http.MethodPost, path, input, f.erpAdmin...); w.Code != http.StatusOK {
		t.Fatalf("retry: %d %s", w.Code, w.Body.String())
	}
	var count int
	if err := a.db.QueryRow("SELECT count(*) FROM outbox_events WHERE organization_id=? AND id=? AND event_type='mes.finished_goods.received' AND status='pending' AND json_extract(payload,'$.sourceReceiptId')=?", f.org, f.eventID, receipt).Scan(&count); err != nil || count != 1 {
		t.Fatalf("event count=%d err=%v", count, err)
	}
	input["idempotencyKey"] = "historical-backfill-0002"
	if w := request(a, http.MethodPost, path, input, f.erpAdmin...); w.Code != http.StatusConflict {
		t.Fatalf("duplicate backfill: %d %s", w.Code, w.Body.String())
	}
	foreign := loginSite(t, a, "admin@suite.test", token(), "erp")
	if w := request(a, http.MethodPost, path, input, foreign...); w.Code != http.StatusForbidden && w.Code != http.StatusNotFound {
		t.Fatalf("foreign backfill: %d %s", w.Code, w.Body.String())
	}
}

func TestMESERPBackfillRollsBackOnAuditFailure(t *testing.T) {
	a := appForTest(t)
	f := prepareMESERPReceiptPostingFixture(t, a)
	var receipt string
	if err := a.db.QueryRow("SELECT json_extract(payload,'$.sourceReceiptId') FROM outbox_events WHERE organization_id=? AND id=?", f.org, f.eventID).Scan(&receipt); err != nil {
		t.Fatal(err)
	}
	if _, err := a.db.Exec("DELETE FROM outbox_events WHERE organization_id=? AND id=?", f.org, f.eventID); err != nil {
		t.Fatal(err)
	}
	if _, err := a.db.Exec(`CREATE TRIGGER test_fail_backfill BEFORE INSERT ON audit_events WHEN NEW.action='erp.mes.backfill' BEGIN SELECT RAISE(ABORT,'simulated failure'); END`); err != nil {
		t.Fatal(err)
	}
	w := request(a, http.MethodPost, "/api/stations/erp/mes-receipt-backfill", map[string]any{"receiptId": receipt, "idempotencyKey": "historical-failure-0001"}, f.erpAdmin...)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("failure status: %d %s", w.Code, w.Body.String())
	}
	var events, keys int
	if err := a.db.QueryRow("SELECT count(*) FROM outbox_events WHERE organization_id=? AND id=?", f.org, f.eventID).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if err := a.db.QueryRow("SELECT count(*) FROM idempotency_keys WHERE organization_id=? AND key='historical-failure-0001'", f.org).Scan(&keys); err != nil {
		t.Fatal(err)
	}
	if events != 0 || keys != 0 {
		t.Fatalf("partial backfill: events=%d keys=%d", events, keys)
	}
}
