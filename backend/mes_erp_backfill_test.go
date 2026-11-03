package main

import (
	"encoding/json"
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

func TestMESERPBackfillRejectsExistingEventForSameReceiptWithDifferentID(t *testing.T) {
	a := appForTest(t)
	f := prepareMESERPReceiptPostingFixture(t, a)
	var receipt, payload string
	if err := a.db.QueryRow("SELECT json_extract(payload,'$.sourceReceiptId'),payload FROM outbox_events WHERE organization_id=? AND id=?", f.org, f.eventID).Scan(&receipt, &payload); err != nil {
		t.Fatalf("read original event: %v", err)
	}
	var event map[string]any
	if err := json.Unmarshal([]byte(payload), &event); err != nil {
		t.Fatalf("decode original event: %v", err)
	}
	if _, err := a.db.Exec("DELETE FROM outbox_events WHERE organization_id=? AND id=?", f.org, f.eventID); err != nil {
		t.Fatalf("remove deterministic event to simulate historical row: %v", err)
	}
	event["eventId"] = "mes.received:alternate-id-" + token()
	alternatePayload, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("marshal alternate event: %v", err)
	}
	if _, err := a.db.Exec("INSERT INTO outbox_events(id,organization_id,event_type,payload,status) VALUES(?,?, 'mes.finished_goods.received',?,'pending')", event["eventId"], f.org, string(alternatePayload)); err != nil {
		t.Fatalf("insert alternate event for source receipt: %v", err)
	}

	key := "backfill-alternate-event-001"
	w := request(a, http.MethodPost, "/api/stations/erp/mes-receipt-backfill", map[string]any{"receiptId": receipt, "idempotencyKey": key}, f.erpAdmin...)
	if w.Code != http.StatusConflict {
		t.Fatalf("backfill should reject existing source event with a different event ID, got %d %s", w.Code, w.Body.String())
	}
	var sourceEvents, generatedEvents, idem int
	if err := a.db.QueryRow("SELECT count(*) FROM outbox_events WHERE organization_id=? AND event_type='mes.finished_goods.received' AND json_extract(payload,'$.sourceReceiptId')=?", f.org, receipt).Scan(&sourceEvents); err != nil {
		t.Fatal(err)
	}
	if err := a.db.QueryRow("SELECT count(*) FROM outbox_events WHERE organization_id=? AND id=?", f.org, f.eventID).Scan(&generatedEvents); err != nil {
		t.Fatal(err)
	}
	if err := a.db.QueryRow("SELECT count(*) FROM idempotency_keys WHERE organization_id=? AND key=? AND endpoint='/station/erp/mes-receipt-backfill'", f.org, key).Scan(&idem); err != nil {
		t.Fatal(err)
	}
	if sourceEvents != 1 || generatedEvents != 0 || idem != 0 {
		t.Fatalf("duplicate-source rejection changed data: sourceEvents=%d generatedEvents=%d idempotency=%d", sourceEvents, generatedEvents, idem)
	}
}

func TestMESERPBackfillRejectsReceiptWithoutMatchingMESInventory(t *testing.T) {
	for _, mode := range []string{"missing", "quantity_mismatch"} {
		t.Run(mode, func(t *testing.T) {
			a := appForTest(t)
			f := prepareMESERPReceiptPostingFixture(t, a)
			var receipt, batch string
			if err := a.db.QueryRow("SELECT id,batch_id FROM mes_finished_goods_receipts WHERE organization_id=? ORDER BY rowid DESC LIMIT 1", f.org).Scan(&receipt, &batch); err != nil {
				t.Fatalf("read source receipt: %v", err)
			}
			if _, err := a.db.Exec("DELETE FROM outbox_events WHERE organization_id=? AND id=?", f.org, f.eventID); err != nil {
				t.Fatalf("remove original event to simulate historical receipt: %v", err)
			}
			switch mode {
			case "missing":
				if _, err := a.db.Exec("DELETE FROM mes_finished_goods_inventory WHERE organization_id=? AND batch_id=?", f.org, batch); err != nil {
					t.Fatalf("remove MES inventory row: %v", err)
				}
			case "quantity_mismatch":
				if _, err := a.db.Exec("UPDATE mes_finished_goods_inventory SET quantity_on_hand=quantity_on_hand-1 WHERE organization_id=? AND batch_id=?", f.org, batch); err != nil {
					t.Fatalf("change MES inventory quantity: %v", err)
				}
			}

			key := "backfill-inventory-" + mode + "-001"
			w := request(a, http.MethodPost, "/api/stations/erp/mes-receipt-backfill", map[string]any{"receiptId": receipt, "idempotencyKey": key}, f.erpAdmin...)
			if w.Code < http.StatusBadRequest || w.Code >= http.StatusInternalServerError {
				t.Fatalf("backfill with %s MES inventory should be rejected, got %d %s", mode, w.Code, w.Body.String())
			}
			var events, idem int
			if err := a.db.QueryRow("SELECT count(*) FROM outbox_events WHERE organization_id=? AND event_type='mes.finished_goods.received' AND json_extract(payload,'$.sourceReceiptId')=?", f.org, receipt).Scan(&events); err != nil {
				t.Fatal(err)
			}
			if err := a.db.QueryRow("SELECT count(*) FROM idempotency_keys WHERE organization_id=? AND key=? AND endpoint='/station/erp/mes-receipt-backfill'", f.org, key).Scan(&idem); err != nil {
				t.Fatal(err)
			}
			if events != 0 || idem != 0 {
				t.Fatalf("rejected inventory mismatch left events=%d idempotency=%d", events, idem)
			}
		})
	}
}
