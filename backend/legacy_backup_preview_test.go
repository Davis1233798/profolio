package main

import "testing"

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
	var count int
	if err := a.db.QueryRow("SELECT count(*) FROM erp_items WHERE id='legacy-item'").Scan(&count); err != nil || count != 0 {
		t.Fatalf("preview wrote data: %d %v", count, err)
	}
	payload["tables"] = map[string]any{"erp_items": []any{map[string]any{"id": "legacy-item", "organizationId": "org_other"}}}
	if w := request(a, "POST", path, payload, admin...); w.Code != 400 {
		t.Fatalf("foreign row %d", w.Code)
	}
}
