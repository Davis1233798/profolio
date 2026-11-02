package main

import (
	"encoding/json"
	"net/http"
	"testing"
)

type finishedGoodsOutboxFixture struct {
	org       string
	batchID   string
	productID string
	quantity  int
	admin     []*http.Cookie
}

func prepareFinishedGoodsOutboxFixture(t *testing.T, a *App) finishedGoodsOutboxFixture {
	t.Helper()
	space := token()
	org := "org_test_" + space
	admin := loginSite(t, a, "admin@suite.test", space, "mes")
	operator := loginSite(t, a, "front@suite.test", space, "mes")
	var workOrderID, productID, operationID string
	var quantity int
	if err := a.db.QueryRow("SELECT id,product_id,target_quantity FROM mes_work_orders WHERE organization_id=? AND status='released' AND materials_staged=1 LIMIT 1", org).Scan(&workOrderID, &productID, &quantity); err != nil {
		t.Fatal(err)
	}
	if err := a.db.QueryRow("SELECT id FROM mes_operations WHERE organization_id=? AND work_order_id=? LIMIT 1", org, workOrderID).Scan(&operationID); err != nil {
		t.Fatal(err)
	}
	if w := request(a, http.MethodPost, "/api/stations/mes/business", map[string]any{"action": "start", "workOrderId": workOrderID}, admin...); w.Code != http.StatusOK {
		t.Fatalf("start work order: %d %s", w.Code, w.Body.String())
	}
	report := request(a, http.MethodPost, "/api/stations/mes/business", map[string]any{
		"action": "report", "workOrderId": workOrderID, "operationId": operationID,
		"goodQuantity": quantity, "scrapQuantity": 0, "idempotencyKey": "fg-outbox-report-" + space,
	}, operator...)
	var reportResult struct {
		Data struct {
			ReportID string `json:"reportId"`
		} `json:"data"`
	}
	if err := json.Unmarshal(report.Body.Bytes(), &reportResult); err != nil || report.Code != http.StatusOK || reportResult.Data.ReportID == "" {
		t.Fatalf("report: %d %v %s", report.Code, err, report.Body.String())
	}
	batchNumber := "FG-OUTBOX-" + space
	created := request(a, http.MethodPost, "/api/stations/mes/finished-goods", map[string]any{
		"action": "createBatch", "workOrderId": workOrderID, "reportId": reportResult.Data.ReportID,
		"batchNumber": batchNumber, "quantity": quantity, "idempotencyKey": "fg-outbox-batch-" + space,
	}, admin...)
	var batchResult struct {
		Data struct {
			BatchID string `json:"batchId"`
		} `json:"data"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &batchResult); err != nil || created.Code != http.StatusOK || batchResult.Data.BatchID == "" {
		t.Fatalf("create batch: %d %v %s", created.Code, err, created.Body.String())
	}
	inspection := request(a, http.MethodPost, "/api/stations/mes/operations", map[string]any{
		"action": "quality", "workOrderId": workOrderID, "reportId": reportResult.Data.ReportID,
		"sample": 1, "failed": 0, "idempotencyKey": "fg-outbox-qc-" + space,
	}, operator...)
	var inspectionResult struct {
		Data struct {
			QualityCheckID string `json:"qualityCheckId"`
		} `json:"data"`
	}
	if err := json.Unmarshal(inspection.Body.Bytes(), &inspectionResult); err != nil || inspection.Code != http.StatusOK || inspectionResult.Data.QualityCheckID == "" {
		t.Fatalf("quality inspection: %d %v %s", inspection.Code, err, inspection.Body.String())
	}
	release := request(a, http.MethodPost, "/api/stations/mes/finished-goods", map[string]any{
		"action": "qualityDisposition", "batchId": batchResult.Data.BatchID,
		"qualityCheckId": inspectionResult.Data.QualityCheckID, "passedQuantity": quantity,
		"failedQuantity": 0, "disposition": "release", "idempotencyKey": "fg-outbox-release-" + space,
	}, admin...)
	if release.Code != http.StatusOK {
		t.Fatalf("release batch: %d %s", release.Code, release.Body.String())
	}
	return finishedGoodsOutboxFixture{org: org, batchID: batchResult.Data.BatchID, productID: productID, quantity: quantity, admin: admin}
}

func TestMESFinishedGoodsReceiptOutboxAtomicityAndRetry(t *testing.T) {
	t.Run("successful receipt emits one versioned event and same-key retry reuses it", func(t *testing.T) {
		a := appForTest(t)
		fixture := prepareFinishedGoodsOutboxFixture(t, a)
		path := "/api/stations/mes/finished-goods"
		input := map[string]any{"action": "receive", "batchId": fixture.batchID, "quantity": fixture.quantity, "idempotencyKey": "fg-outbox-receive-" + token()}
		first := request(a, http.MethodPost, path, input, fixture.admin...)
		if first.Code != http.StatusOK {
			t.Fatalf("receive: %d %s", first.Code, first.Body.String())
		}
		var receiptID, eventID, payload string
		if err := a.db.QueryRow("SELECT id FROM mes_finished_goods_receipts WHERE organization_id=? AND batch_id=?", fixture.org, fixture.batchID).Scan(&receiptID); err != nil {
			t.Fatalf("receipt row missing: %v", err)
		}
		if err := a.db.QueryRow("SELECT id,payload FROM outbox_events WHERE organization_id=? AND event_type='mes.finished_goods.received'", fixture.org).Scan(&eventID, &payload); err != nil {
			t.Fatalf("receipt event missing: %v", err)
		}
		if eventID == "" {
			t.Fatal("event ID must be stable and non-empty")
		}
		var event struct {
			SchemaVersion int    `json:"schemaVersion"`
			Organization  string `json:"organizationId"`
			SourceReceipt string `json:"sourceReceiptId"`
			Batch         string `json:"batchId"`
			Product       string `json:"mesProductId"`
			Quantity      int    `json:"quantity"`
			OccurredAt    string `json:"occurredAt"`
		}
		if err := json.Unmarshal([]byte(payload), &event); err != nil {
			t.Fatalf("invalid event payload: %v", err)
		}
		if event.SchemaVersion != 1 || event.Organization != fixture.org || event.SourceReceipt != receiptID || event.Batch != fixture.batchID || event.Product != fixture.productID || event.Quantity != fixture.quantity || event.OccurredAt == "" {
			t.Fatalf("incomplete receipt event: %+v", event)
		}
		retry := request(a, http.MethodPost, path, input, fixture.admin...)
		if retry.Code != http.StatusOK {
			t.Fatalf("same-key receive retry: %d %s", retry.Code, retry.Body.String())
		}
		var receipts, events int
		if err := a.db.QueryRow("SELECT count(*) FROM mes_finished_goods_receipts WHERE organization_id=? AND batch_id=?", fixture.org, fixture.batchID).Scan(&receipts); err != nil {
			t.Fatal(err)
		}
		if err := a.db.QueryRow("SELECT count(*) FROM outbox_events WHERE organization_id=? AND event_type='mes.finished_goods.received'", fixture.org).Scan(&events); err != nil {
			t.Fatal(err)
		}
		if receipts != 1 || events != 1 {
			t.Fatalf("retry duplicated receipt/event: receipts=%d events=%d", receipts, events)
		}
	})

	t.Run("failed MES transaction leaves no receipt inventory audit or event", func(t *testing.T) {
		a := appForTest(t)
		fixture := prepareFinishedGoodsOutboxFixture(t, a)
		if _, err := a.db.Exec("CREATE TRIGGER test_fail_finished_goods_receipt_audit BEFORE INSERT ON audit_events WHEN NEW.action='mes.finished_goods.receive' BEGIN SELECT RAISE(ABORT, 'simulated audit failure'); END"); err != nil {
			t.Fatal(err)
		}
		response := request(a, http.MethodPost, "/api/stations/mes/finished-goods", map[string]any{
			"action": "receive", "batchId": fixture.batchID, "quantity": fixture.quantity,
			"idempotencyKey": "fg-outbox-fail-" + token(),
		}, fixture.admin...)
		if response.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected failed transaction, got %d %s", response.Code, response.Body.String())
		}
		var receipts, inventory, audits, events int
		for _, check := range []struct {
			query string
			args  []any
			out   *int
		}{
			{"SELECT count(*) FROM mes_finished_goods_receipts WHERE organization_id=? AND batch_id=?", []any{fixture.org, fixture.batchID}, &receipts},
			{"SELECT count(*) FROM mes_finished_goods_inventory WHERE organization_id=? AND batch_id=?", []any{fixture.org, fixture.batchID}, &inventory},
			{"SELECT count(*) FROM audit_events WHERE organization_id=? AND entity_id=? AND action='mes.finished_goods.receive'", []any{fixture.org, fixture.batchID}, &audits},
			{"SELECT count(*) FROM outbox_events WHERE organization_id=? AND event_type='mes.finished_goods.received'", []any{fixture.org}, &events},
		} {
			if err := a.db.QueryRow(check.query, check.args...).Scan(check.out); err != nil {
				t.Fatal(err)
			}
		}
		if receipts != 0 || inventory != 0 || audits != 0 || events != 0 {
			t.Fatalf("failed receipt left partial state: receipts=%d inventory=%d audits=%d events=%d", receipts, inventory, audits, events)
		}
	})
}
