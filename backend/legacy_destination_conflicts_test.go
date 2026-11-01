package main

import "testing"

func TestLegacyDestinationConflictIsTenantScoped(t *testing.T) {
	a := appForTest(t)
	if _, err := a.db.Exec("INSERT INTO erp_items(id,organization_id,sku,name) VALUES('existing','org_test_a','SKU','Item')"); err != nil {
		t.Fatal(err)
	}
	rows := map[string][]map[string]any{"erp_items": {{"id": "existing"}}}
	if err := checkLegacyDestinationConflicts(a.db, "org_test_a", rows); err == nil {
		t.Fatal("same-tenant conflict accepted")
	}
	if err := checkLegacyDestinationConflicts(a.db, "org_test_b", rows); err != nil {
		t.Fatalf("other tenant leaked: %v", err)
	}
}
