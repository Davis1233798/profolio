package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

const mesERPWorkspacePath = "/api/stations/erp/mes-integration"

func getMESERPWorkspace(a *App, cookies []*http.Cookie) *httptest.ResponseRecorder {
	return request(a, http.MethodGet, mesERPWorkspacePath, nil, cookies...)
}

func decodeMESERPWorkspace(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var response struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode ERP MES workspace response: %v; body=%s", err, w.Body.String())
	}
	if response.Data == nil {
		t.Fatalf("ERP MES workspace response has no data object: %s", w.Body.String())
	}
	return response.Data
}

func workspaceRows(t *testing.T, data map[string]any, key string) []any {
	t.Helper()
	value, ok := data[key]
	if !ok {
		t.Fatalf("workspace response missing %q array", key)
	}
	rows, ok := value.([]any)
	if !ok || rows == nil {
		t.Fatalf("workspace %q must be a JSON array, got %#v", key, value)
	}
	return rows
}

func assertWorkspaceFields(t *testing.T, rows []any, dataset string, required ...string) {
	t.Helper()
	if len(rows) == 0 {
		t.Fatalf("expected %s rows to verify their fields", dataset)
	}
	for i, value := range rows {
		row, ok := value.(map[string]any)
		if !ok {
			t.Fatalf("%s row %d is not an object: %#v", dataset, i, value)
		}
		for _, field := range required {
			if _, ok := row[field]; !ok {
				t.Errorf("%s row %d missing field %q: %#v", dataset, i, field, row)
			}
		}
	}
}

func TestMESERPWorkspaceRequiresCurrentMESAndERPAdministratorGrants(t *testing.T) {
	for _, revokedSite := range []string{"mes", "erp"} {
		t.Run("revoked_"+revokedSite, func(t *testing.T) {
			a := appForTest(t)
			f := prepareMESERPReceiptPostingFixture(t, a)
			var userID string
			if err := a.db.QueryRow("SELECT user_id FROM station_accounts WHERE organization_id=? AND email=?", f.org, "admin@suite.test").Scan(&userID); err != nil {
				t.Fatalf("find administrator: %v", err)
			}
			if _, err := a.db.Exec("UPDATE station_grants SET role='operator' WHERE user_id=? AND site=?", userID, revokedSite); err != nil {
				t.Fatalf("revoke %s administrator grant: %v", revokedSite, err)
			}
			w := getMESERPWorkspace(a, f.erpAdmin)
			if w.Code != http.StatusForbidden {
				t.Fatalf("GET after %s grant revocation: got %d %s", revokedSite, w.Code, w.Body.String())
			}
		})
	}
}

func TestMESERPWorkspaceReturnsTenantScopedDatasetsAndRequiredFields(t *testing.T) {
	a := appForTest(t)
	local := prepareMESERPReceiptPostingFixture(t, a)
	foreign := prepareMESERPReceiptPostingFixture(t, a)
	w := getMESERPWorkspace(a, local.erpAdmin)
	if w.Code != http.StatusOK {
		t.Fatalf("GET ERP MES workspace: %d %s", w.Code, w.Body.String())
	}
	data := decodeMESERPWorkspace(t, w)
	products := workspaceRows(t, data, "products")
	items := workspaceRows(t, data, "items")
	warehouses := workspaceRows(t, data, "warehouses")
	mappings := workspaceRows(t, data, "mappings")
	events := workspaceRows(t, data, "events")
	assertWorkspaceFields(t, products, "products", "id", "sku", "name", "unit", "status")
	assertWorkspaceFields(t, items, "items", "id", "sku", "name", "unit", "isActive")
	assertWorkspaceFields(t, warehouses, "warehouses", "id", "name", "code", "isActive")
	assertWorkspaceFields(t, mappings, "mappings", "id", "mesProductId", "erpItemId", "warehouseId", "version", "isActive")
	assertWorkspaceFields(t, events, "events", "id", "status", "eventId", "sourceReceiptId", "batchId", "mesProductId", "quantity", "occurredAt")

	for _, rows := range [][]any{products, items, warehouses, mappings, events} {
		for _, value := range rows {
			row := value.(map[string]any)
			for _, field := range []string{"id", "mesProductId", "erpItemId", "warehouseId", "eventId", "sourceReceiptId", "batchId"} {
				if row[field] == foreign.eventID || row[field] == foreign.productID || row[field] == foreign.itemID || row[field] == foreign.warehouseID || row[field] == foreign.mappingID {
					t.Fatalf("foreign tenant identifier leaked in %q row: %#v", field, row)
				}
			}
			if _, leaked := row["payload"]; leaked {
				t.Fatalf("raw event payload must not be exposed: %#v", row)
			}
		}
	}
	assertWorkspaceContains(t, products, "id", local.productID)
	assertWorkspaceContains(t, items, "id", local.itemID)
	assertWorkspaceContains(t, warehouses, "id", local.warehouseID)
	assertWorkspaceContains(t, mappings, "id", local.mappingID)
	assertWorkspaceContains(t, events, "id", local.eventID)
}

func assertWorkspaceContains(t *testing.T, rows []any, field, want string) {
	t.Helper()
	for _, value := range rows {
		row, ok := value.(map[string]any)
		if ok && row[field] == want {
			return
		}
	}
	t.Fatalf("workspace rows do not include %s=%q", field, want)
}

func TestMESERPWorkspaceReturnsArraysForNewTenant(t *testing.T) {
	a := appForTest(t)
	space := token()
	_ = loginSite(t, a, "admin@suite.test", space, "mes")
	erpAdmin := loginSite(t, a, "admin@suite.test", space, "erp")
	w := getMESERPWorkspace(a, erpAdmin)
	if w.Code != http.StatusOK {
		t.Fatalf("GET empty ERP MES workspace: %d %s", w.Code, w.Body.String())
	}
	data := decodeMESERPWorkspace(t, w)
	for _, key := range []string{"products", "items", "warehouses", "mappings", "events"} {
		workspaceRows(t, data, key)
	}
}

func TestMESERPWorkspaceKeepsOlderPendingEventWithin500EventLimit(t *testing.T) {
	a := appForTest(t)
	f := prepareMESERPReceiptPostingFixture(t, a)
	tx, err := a.db.Begin()
	if err != nil {
		t.Fatalf("begin newer processed event fixture: %v", err)
	}
	for i := 0; i < 500; i++ {
		eventID := "mes.received:processed-" + token()
		payload, marshalErr := json.Marshal(map[string]any{
			"eventId": eventID, "schemaVersion": 1, "organizationId": f.org,
			"sourceReceiptId": "receipt-" + token(), "batchId": "batch-" + token(),
			"mesProductId": f.productID, "quantity": 1, "occurredAt": "2026-11-03T00:00:00Z",
		})
		if marshalErr != nil {
			tx.Rollback()
			t.Fatalf("marshal processed event payload: %v", marshalErr)
		}
		if _, err := tx.Exec("INSERT INTO outbox_events(id,organization_id,event_type,payload,status) VALUES(?,?,'mes.finished_goods.received',?,'processed')", eventID, f.org, string(payload)); err != nil {
			tx.Rollback()
			t.Fatalf("insert newer processed event %d: %v", i, err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit newer processed event fixture: %v", err)
	}

	w := getMESERPWorkspace(a, f.erpAdmin)
	if w.Code != http.StatusOK {
		t.Fatalf("GET ERP MES workspace with event history: %d %s", w.Code, w.Body.String())
	}
	events := workspaceRows(t, decodeMESERPWorkspace(t, w), "events")
	if len(events) > 500 {
		t.Fatalf("workspace returned %d events, exceeds 500-row limit", len(events))
	}
	if !workspaceHasRow(events, "id", f.eventID) {
		t.Fatalf("older pending event %q was hidden by newer processed events", f.eventID)
	}
}

func workspaceHasRow(rows []any, field string, want any) bool {
	for _, value := range rows {
		row, ok := value.(map[string]any)
		if ok && row[field] == want {
			return true
		}
	}
	return false
}

func TestMESERPWorkspaceHistoricalReceiptsOnlyListsBackfillableInventory(t *testing.T) {
	a := appForTest(t)
	f := prepareMESERPReceiptPostingFixture(t, a)
	var legalReceipt, workOrderID, operationID, operatorID string
	if err := a.db.QueryRow(`SELECT r.id,b.work_order_id,rpt.operation_id,rpt.operator_id
		FROM mes_finished_goods_receipts r
		JOIN mes_finished_goods_batches b ON b.organization_id=r.organization_id AND b.id=r.batch_id
		JOIN mes_production_reports rpt ON rpt.organization_id=b.organization_id AND rpt.id=b.report_id
		WHERE r.organization_id=? AND r.batch_id=(SELECT batch_id FROM mes_finished_goods_receipts WHERE organization_id=? ORDER BY rowid DESC LIMIT 1)
		ORDER BY r.rowid DESC LIMIT 1`, f.org, f.org).Scan(&legalReceipt, &workOrderID, &operationID, &operatorID); err != nil {
		t.Fatalf("read legal receipt lineage: %v", err)
	}
	if _, err := a.db.Exec("DELETE FROM outbox_events WHERE organization_id=? AND id=?", f.org, f.eventID); err != nil {
		t.Fatalf("remove original event to model historical receipt: %v", err)
	}

	makeReceipt := func(name string, batchQuantity, receiptQuantity int, inventoryQuantity *int) string {
		t.Helper()
		suffix := token()
		reportID := "workspace-history-report-" + suffix
		batchID := "workspace-history-batch-" + suffix
		receiptID := "workspace-history-receipt-" + suffix
		if _, err := a.db.Exec("INSERT INTO mes_production_reports(id,organization_id,work_order_id,operation_id,operator_id,good_quantity,scrap_quantity) VALUES(?,?,?,?,?,?,0)", reportID, f.org, workOrderID, operationID, operatorID, batchQuantity); err != nil {
			t.Fatalf("insert %s report: %v", name, err)
		}
		if _, err := a.db.Exec("INSERT INTO mes_finished_goods_batches(id,organization_id,work_order_id,report_id,batch_number,quantity,status) VALUES(?,?,?,?,?,?,'received')", batchID, f.org, workOrderID, reportID, "HISTORY-"+suffix, batchQuantity); err != nil {
			t.Fatalf("insert %s batch: %v", name, err)
		}
		if _, err := a.db.Exec("INSERT INTO mes_finished_goods_receipts(id,organization_id,batch_id,quantity,idempotency_key) VALUES(?,?,?,?,?)", receiptID, f.org, batchID, receiptQuantity, "history-key-"+suffix); err != nil {
			t.Fatalf("insert %s receipt: %v", name, err)
		}
		if inventoryQuantity != nil {
			if _, err := a.db.Exec("INSERT INTO mes_finished_goods_inventory(id,organization_id,batch_id,quantity_on_hand) VALUES(?,?,?,?)", "workspace-history-inventory-"+suffix, f.org, batchID, *inventoryQuantity); err != nil {
				t.Fatalf("insert %s inventory: %v", name, err)
			}
		}
		return receiptID
	}
	missingInventory := makeReceipt("missing inventory", 2, 2, nil)
	wrongInventoryQuantity := 1
	mismatchedInventory := makeReceipt("mismatched inventory", 2, 2, &wrongInventoryQuantity)
	receiptMismatchInventory := 1
	mismatchedReceipt := makeReceipt("receipt quantity mismatch", 2, 1, &receiptMismatchInventory)

	w := getMESERPWorkspace(a, f.erpAdmin)
	if w.Code != http.StatusOK {
		t.Fatalf("GET ERP MES workspace: %d %s", w.Code, w.Body.String())
	}
	receipts := workspaceRows(t, decodeMESERPWorkspace(t, w), "historicalReceipts")
	if !workspaceHasRow(receipts, "id", legalReceipt) {
		t.Fatalf("valid historical receipt %q was omitted: %#v", legalReceipt, receipts)
	}
	for _, invalidID := range []string{missingInventory, mismatchedInventory, mismatchedReceipt} {
		if workspaceHasRow(receipts, "id", invalidID) {
			t.Errorf("ineligible historical receipt %q was listed: %#v", invalidID, receipts)
		}
	}
}

func TestMESERPWorkspaceListsHistoricalReceiptsUntilBackfilled(t *testing.T) {
	a := appForTest(t)
	f := prepareMESERPReceiptPostingFixture(t, a)
	var receipt string
	if err := a.db.QueryRow("SELECT json_extract(payload,'$.sourceReceiptId') FROM outbox_events WHERE organization_id=? AND id=?", f.org, f.eventID).Scan(&receipt); err != nil {
		t.Fatal(err)
	}
	if _, err := a.db.Exec("DELETE FROM outbox_events WHERE organization_id=? AND id=?", f.org, f.eventID); err != nil {
		t.Fatal(err)
	}
	get := func() []any {
		w := getMESERPWorkspace(a, f.erpAdmin)
		if w.Code != http.StatusOK {
			t.Fatalf("workspace %d %s", w.Code, w.Body.String())
		}
		return workspaceRows(t, decodeMESERPWorkspace(t, w), "historicalReceipts")
	}
	if !workspaceHasRow(get(), "id", receipt) {
		t.Fatal("historical receipt not listed")
	}
	response := request(a, http.MethodPost, "/api/stations/erp/mes-receipt-backfill", map[string]any{"receiptId": receipt, "idempotencyKey": "historical-workspace-0001"}, f.erpAdmin...)
	if response.Code != http.StatusOK {
		t.Fatalf("backfill %d %s", response.Code, response.Body.String())
	}
	if workspaceHasRow(get(), "id", receipt) {
		t.Fatal("backfilled receipt still listed")
	}
}
