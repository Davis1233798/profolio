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

func TestLegacyCandidateRetryAndAudit(t *testing.T) {
	a := appForTest(t)
	space := token()
	loginSite(t, a, "admin@suite.test", space, "erp")
	org := "org_test_" + space
	id := &Identity{OrganizationID: org, UserID: org + "_admin"}
	backup := legacyBackupPreview{OrganizationID: "org_old", Tables: map[string][]map[string]any{}}
	for _, table := range legacyBackupTables {
		backup.Tables[table] = []map[string]any{}
	}
	backup.Tables["erp_items"] = []map[string]any{{"id": "retry-item", "organizationId": "org_old", "sku": "retry", "name": "Item", "unit": "PCS", "boxConversionRatio": float64(1), "category": "general", "isActive": true, "createdAt": "2026-01-01"}}
	for i := 0; i < 2; i++ {
		tx, err := a.db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		count, err := recordLegacyCandidate(tx, id, backup, nil, "legacy-retry-key")
		if err != nil || count != 1 {
			tx.Rollback()
			t.Fatalf("retry %d: %d %v", i, count, err)
		}
		if err = tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	var audit int
	if err := a.db.QueryRow("SELECT count(*) FROM audit_events WHERE organization_id=? AND action='legacy.import'", org).Scan(&audit); err != nil || audit != 1 {
		t.Fatalf("audit %d %v", audit, err)
	}
	backup.Tables["erp_items"][0]["name"] = "Changed"
	tx, err := a.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err = recordLegacyCandidate(tx, id, backup, nil, "legacy-retry-key"); err == nil {
		t.Fatal("changed retry accepted")
	}
}
