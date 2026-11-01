package main

import "testing"

func TestLegacyCandidateTransactionIsAtomic(t *testing.T) {
	a := appForTest(t)
	space := token()
	loginSite(t, a, "admin@suite.test", space, "erp")
	org := "org_test_" + space
	backup := legacyBackupPreview{OrganizationID: "org_old", Tables: map[string][]map[string]any{}}
	for _, table := range legacyBackupTables {
		backup.Tables[table] = []map[string]any{}
	}
	backup.Tables["erp_items"] = []map[string]any{{"id": "candidate-item", "organizationId": "org_old", "sku": "candidate", "name": "Item", "unit": "PCS", "boxConversionRatio": float64(1), "category": "general", "isActive": true, "createdAt": "2026-01-01"}}
	tx, err := a.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	count, err := applyLegacyCandidate(tx, org, backup, nil)
	if err != nil || count != 1 {
		tx.Rollback()
		t.Fatalf("candidate %d %v", count, err)
	}
	if err = tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	var countStored int
	if err = a.db.QueryRow("SELECT count(*) FROM erp_items WHERE id='candidate-item'").Scan(&countStored); err != nil || countStored != 0 {
		t.Fatalf("rollback %d %v", countStored, err)
	}
}
