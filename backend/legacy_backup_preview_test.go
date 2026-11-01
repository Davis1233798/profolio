package main

import (
	"fmt"
	"strings"
	"testing"
)

func TestLegacyBackupPreviewIsReadOnlyAndTenantScoped(t *testing.T) {
	a := appForTest(t)
	space := token()
	admin := loginSite(t, a, "admin@suite.test", space, "erp")
	front := loginSite(t, a, "front@suite.test", space, "erp")
	payload := map[string]any{"format": "business-suite/v1", "organizationId": "org_source", "exportedAt": "2026-01-01T00:00:00Z", "tables": map[string]any{"erp_items": []any{map[string]any{"id": "legacy-item", "organizationId": "org_source"}}}}
	path := "/api/stations/erp/legacy-backup-preview"
	if w := request(a, "POST", path, payload, front...); w.Code != 403 {
		t.Fatalf("front access %d", w.Code)
	}
	if w := request(a, "POST", path, payload, admin...); w.Code != 200 || !strings.Contains(w.Body.String(), `"missingTables"`) || !strings.Contains(w.Body.String(), `"mes_products"`) {
		t.Fatalf("preview missing table detection %d: %s", w.Code, w.Body.String())
	}
	payload["tables"] = map[string]any{"erp_items": nil}
	if w := request(a, "POST", path, payload, admin...); w.Code != 400 || !strings.Contains(w.Body.String(), "must contain arrays") {
		t.Fatalf("null table accepted: %d %s", w.Code, w.Body.String())
	}
	manyTables := map[string]any{}
	for i := 0; i < 201; i++ {
		manyTables[fmt.Sprintf("erp_table_%d", i)] = []any{}
	}
	payload["tables"] = manyTables
	if w := request(a, "POST", path, payload, admin...); w.Code != 400 || !strings.Contains(w.Body.String(), "200 table limit") {
		t.Fatalf("table limit: %d %s", w.Code, w.Body.String())
	}
	payload["tables"] = map[string]any{"station_accounts": []any{}}
	if w := request(a, "POST", path, payload, admin...); w.Code != 200 || !strings.Contains(w.Body.String(), "Empty legacy station_accounts") {
		t.Fatalf("empty identity table: %d %s", w.Code, w.Body.String())
	}
	payload["tables"] = map[string]any{"station_accounts": []any{map[string]any{"passwordHash": "secret"}}}
	if w := request(a, "POST", path, payload, admin...); w.Code != 400 || strings.Contains(w.Body.String(), "secret") {
		t.Fatalf("identity records not rejected safely: %d %s", w.Code, w.Body.String())
	}
	payload["tables"] = map[string]any{"erp_missing": []any{}, "erp_items": []any{map[string]any{"id": "legacy-item", "organizationId": "org_source", "unknownField": true}}}
	if w := request(a, "POST", path, payload, admin...); w.Code != 200 || !strings.Contains(w.Body.String(), "erp_missing") || !strings.Contains(w.Body.String(), "unknownField") || !strings.Contains(w.Body.String(), "missing required field") {
		t.Fatalf("schema warning: %d %s", w.Code, w.Body.String())
	}
	payload["tables"] = map[string]any{"crm_accounts": []any{map[string]any{"id": "a", "organizationId": "org_source", "ownerId": "legacy-user"}, map[string]any{"id": "a", "organizationId": "org_source", "ownerId": "legacy-user"}}}
	if w := request(a, "POST", path, payload, admin...); w.Code != 200 || !strings.Contains(w.Body.String(), `"crm_accounts":1`) || !strings.Contains(w.Body.String(), `"crm_accounts.ownerId":2`) || !strings.Contains(w.Body.String(), `"legacy-user":2`) {
		t.Fatalf("identity and duplicate counts: %d %s", w.Code, w.Body.String())
	}
	payload["tables"] = map[string]any{"erp_items": []any{map[string]any{"id": "unrelated", "organizationId": "org_source", "ownerId": "not-an-account"}}}
	if w := request(a, "POST", path, payload, admin...); w.Code != 200 || strings.Contains(w.Body.String(), `"not-an-account"`) {
		t.Fatalf("unrecognized identity field included: %d %s", w.Code, w.Body.String())
	}
	if _, err := a.db.Exec("INSERT INTO erp_items(id,organization_id,sku,name) VALUES('conflict-item',?,'conflict-sku','Conflict')", "org_test_"+space); err != nil {
		t.Fatal(err)
	}
	payload["tables"] = map[string]any{"erp_items": []any{map[string]any{"id": "conflict-item", "organizationId": "org_source"}}}
	if w := request(a, "POST", path, payload, admin...); w.Code != 200 || !strings.Contains(w.Body.String(), `"destinationConflicts":{"erp_items":1}`) {
		t.Fatalf("destination conflict: %d %s", w.Code, w.Body.String())
	}
	payload["tables"] = map[string]any{"erp_purchase_orders": []any{map[string]any{"id": "po", "organizationId": "org_source", "supplierId": "missing"}}, "erp_suppliers": []any{}}
	if w := request(a, "POST", path, payload, admin...); w.Code != 200 || !strings.Contains(w.Body.String(), `"erp_purchase_orders.supplierId":1`) {
		t.Fatalf("missing reference: %d %s", w.Code, w.Body.String())
	}
	payload["tables"] = map[string]any{"erp_invoices": []any{map[string]any{"id": "invoice", "organizationId": "org_source", "paidAmount": 101, "totalAmount": 100}}}
	if w := request(a, "POST", path, payload, admin...); w.Code != 200 || !strings.Contains(w.Body.String(), `"erp_invoices.payment":1`) {
		t.Fatalf("invalid payment: %d %s", w.Code, w.Body.String())
	}
	payload["tables"] = map[string]any{"erp_invoices": []any{map[string]any{"id": "bad-type", "organizationId": "org_source", "paidAmount": "100"}}}
	if w := request(a, "POST", path, payload, admin...); w.Code != 200 || !strings.Contains(w.Body.String(), "invalid type for paidAmount") {
		t.Fatalf("invalid type: %d %s", w.Code, w.Body.String())
	}
	payload["tables"] = map[string]any{"erp_items": []any{map[string]any{"id": "bool-type", "organizationId": "org_source", "isActive": true, "boxConversionRatio": true}}}
	if w := request(a, "POST", path, payload, admin...); w.Code != 200 || !strings.Contains(w.Body.String(), "invalid type for boxConversionRatio") || strings.Contains(w.Body.String(), "invalid type for isActive") {
		t.Fatalf("boolean type distinction: %d %s", w.Code, w.Body.String())
	}
	payload["tables"] = map[string]any{"erp_stock_ledger": []any{map[string]any{"id": "l1", "organizationId": "org_source", "itemId": "item", "warehouseId": "warehouse", "quantityChange": 5, "balanceAfter": 5}, map[string]any{"id": "l2", "organizationId": "org_source", "itemId": "item", "warehouseId": "warehouse", "quantityChange": -2, "balanceAfter": 4}}}
	if w := request(a, "POST", path, payload, admin...); w.Code != 200 || !strings.Contains(w.Body.String(), `"erp_stock_ledger.balance":1`) {
		t.Fatalf("ledger inconsistency: %d %s", w.Code, w.Body.String())
	}
	var count int
	if err := a.db.QueryRow("SELECT count(*) FROM erp_items WHERE id='legacy-item'").Scan(&count); err != nil || count != 0 {
		t.Fatalf("preview wrote data: %d %v", count, err)
	}
	payload["tables"] = map[string]any{"erp_items": []any{map[string]any{"id": "legacy-item", "organizationId": "org_other"}}}
	if w := request(a, "POST", path, payload, admin...); w.Code != 400 {
		t.Fatalf("foreign row %d", w.Code)
	}
}
