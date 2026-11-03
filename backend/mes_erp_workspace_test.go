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
