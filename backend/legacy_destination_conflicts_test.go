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
	if err := checkLegacyDestinationConflicts(a.db, "org_test_b", rows); err == nil {
		t.Fatal("global primary key conflict missed")
	}
	tx, err := a.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err = tx.Exec("INSERT INTO erp_items(id,organization_id,sku,name) VALUES('pending','org_test_b','NEXT','Pending')"); err != nil {
		t.Fatal(err)
	}
	pending := map[string][]map[string]any{"erp_items": {{"id": "pending"}}}
	if err = checkLegacyDestinationConflicts(tx, "org_test_b", pending); err == nil {
		t.Fatal("transaction-local conflict missed")
	}
}
