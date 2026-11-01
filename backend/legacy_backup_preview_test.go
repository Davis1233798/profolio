package main

import (
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
	if w := request(a, "POST", path, payload, admin...); w.Code != 200 {
		t.Fatalf("preview %d: %s", w.Code, w.Body.String())
	}
	payload["tables"] = map[string]any{"erp_missing": []any{}, "erp_items": []any{map[string]any{"id": "legacy-item", "organizationId": "org_source", "unknownField": true}}}
	if w := request(a, "POST", path, payload, admin...); w.Code != 200 || !strings.Contains(w.Body.String(), "erp_missing") || !strings.Contains(w.Body.String(), "unknownField") || !strings.Contains(w.Body.String(), "missing required field") {
		t.Fatalf("schema warning: %d %s", w.Code, w.Body.String())
	}
	payload["tables"] = map[string]any{"crm_accounts": []any{map[string]any{"id": "a", "organizationId": "org_source", "ownerId": "legacy-user"}, map[string]any{"id": "a", "organizationId": "org_source", "ownerId": "legacy-user"}}}
	if w := request(a, "POST", path, payload, admin...); w.Code != 200 || !strings.Contains(w.Body.String(), `"crm_accounts":1`) || !strings.Contains(w.Body.String(), `"crm_accounts.ownerId":2`) {
		t.Fatalf("identity and duplicate counts: %d %s", w.Code, w.Body.String())
	}
	if _, err := a.db.Exec("INSERT INTO erp_items(id,organization_id,sku,name) VALUES('conflict-item',?,'conflict-sku','Conflict')", "org_test_"+space); err != nil {
		t.Fatal(err)
	}
	payload["tables"] = map[string]any{"erp_items": []any{map[string]any{"id": "conflict-item", "organizationId": "org_source"}}}
	if w := request(a, "POST", path, payload, admin...); w.Code != 200 || !strings.Contains(w.Body.String(), `"destinationConflicts":{"erp_items":1}`) {
		t.Fatalf("destination conflict: %d %s", w.Code, w.Body.String())
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
