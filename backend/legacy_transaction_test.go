package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestLegacyCandidateTransactionIsAtomic(t *testing.T) {
	a := appForTest(t)
	space := token()
	loginSite(t, a, "admin@suite.test", space, "erp")
	org := "org_test_" + space
	backup := legacyBackupPreview{Format: "business-suite/v1", ExportedAt: "2026-01-01T00:00:00Z", OrganizationID: "org_old", Tables: map[string][]map[string]any{}}
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

func TestLegacyImportSessionRecheckedInTransaction(t *testing.T) {
	a := appForTest(t)
	space := token()
	cookies := loginSite(t, a, "admin@suite.test", space, "erp")
	var session string
	for _, cookie := range cookies {
		if cookie.Name == cookieName {
			session = cookie.Value
		}
	}
	if session == "" {
		t.Fatal("missing session cookie")
	}
	org := "org_test_" + space
	id := &Identity{OrganizationID: org, UserID: org + "_admin"}
	tx, err := a.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err = verifyLegacyImportSession(tx, id, session); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec("DELETE FROM station_sessions WHERE token_hash=?", digest(session)); err != nil {
		t.Fatal(err)
	}
	if err = verifyLegacyImportSession(tx, id, session); err == nil {
		t.Fatal("logged-out session accepted")
	}
}

func TestLegacyCandidateRejectsLoggedOutSession(t *testing.T) {
	a := appForTest(t)
	space := token()
	cookies := loginSite(t, a, "admin@suite.test", space, "erp")
	var session string
	for _, cookie := range cookies {
		if cookie.Name == cookieName {
			session = cookie.Value
		}
	}
	if session == "" {
		t.Fatal("missing session cookie")
	}
	org := "org_test_" + space
	id := &Identity{OrganizationID: org, UserID: org + "_admin"}
	backup := legacyBackupPreview{Format: "business-suite/v1", ExportedAt: "2026-01-01T00:00:00Z", OrganizationID: "org_old", Tables: map[string][]map[string]any{}}
	for _, table := range legacyBackupTables {
		backup.Tables[table] = []map[string]any{}
	}
	tx, err := a.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err = tx.Exec("DELETE FROM station_sessions WHERE token_hash=?", digest(session)); err != nil {
		t.Fatal(err)
	}
	if _, err = recordLegacyCandidate(tx, id, session, backup, nil, "logout-import-key"); err == nil {
		t.Fatal("logged-out import accepted")
	}
	var count int
	if err = tx.QueryRow("SELECT count(*) FROM audit_events WHERE organization_id=? AND action='legacy.import'", org).Scan(&count); err != nil || count != 0 {
		t.Fatalf("unexpected audit %d %v", count, err)
	}
}

func TestLegacyCandidateRejectsInvalidExportTime(t *testing.T) {
	a := appForTest(t)
	space := token()
	cookies := loginSite(t, a, "admin@suite.test", space, "erp")
	var session string
	for _, cookie := range cookies {
		if cookie.Name == cookieName {
			session = cookie.Value
		}
	}
	org := "org_test_" + space
	id := &Identity{OrganizationID: org, UserID: org + "_admin"}
	backup := legacyBackupPreview{Format: "business-suite/v1", ExportedAt: "not-a-date", OrganizationID: "org_old", Tables: map[string][]map[string]any{}}
	tx, err := a.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err = recordLegacyCandidate(tx, id, session, backup, nil, "invalid-date-key"); err == nil {
		t.Fatal("invalid export time accepted")
	}
}

func TestLegacyCandidateSnapshotAndCommit(t *testing.T) {
	a := appForTest(t)
	space := token()
	cookies := loginSite(t, a, "admin@suite.test", space, "erp")
	var session string
	for _, cookie := range cookies {
		if cookie.Name == cookieName {
			session = cookie.Value
		}
	}
	if session == "" {
		t.Fatal("missing session")
	}
	org := "org_test_" + space
	id := &Identity{OrganizationID: org, UserID: org + "_admin"}
	backup := legacyBackupPreview{Format: "business-suite/v1", ExportedAt: "2026-01-01T00:00:00Z", OrganizationID: "org_old", Tables: map[string][]map[string]any{}}
	for _, table := range legacyBackupTables {
		backup.Tables[table] = []map[string]any{}
	}
	backup.Tables["erp_items"] = []map[string]any{{"id": "snapshot-candidate", "organizationId": "org_old", "sku": "snapshot-candidate", "name": "Item", "unit": "PCS", "boxConversionRatio": float64(1), "category": "general", "isActive": true, "createdAt": "2026-01-01"}}
	path := filepath.Join(t.TempDir(), "before.sqlite")
	count, err := importLegacyWithSnapshot(context.Background(), a.db, path, id, session, backup, nil, "legacy-snapshot-key")
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("imported rows: %d", count)
	}
	var current int
	if err = a.db.QueryRow("SELECT count(*) FROM erp_items WHERE id='snapshot-candidate'").Scan(&current); err != nil || current != 1 {
		t.Fatalf("current %d %v", current, err)
	}
	snapshot, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer snapshot.Close()
	var previous int
	if err = snapshot.QueryRow("SELECT count(*) FROM erp_items WHERE id='snapshot-candidate'").Scan(&previous); err != nil || previous != 0 {
		t.Fatalf("snapshot %d %v", previous, err)
	}
}

func TestLegacyCandidateSnapshotRetainedWhenImportFails(t *testing.T) {
	a := appForTest(t)
	space := token()
	cookies := loginSite(t, a, "admin@suite.test", space, "erp")
	var session string
	for _, cookie := range cookies {
		if cookie.Name == cookieName {
			session = cookie.Value
		}
	}
	org := "org_test_" + space
	id := &Identity{OrganizationID: org, UserID: org + "_admin"}
	backup := legacyBackupPreview{Format: "business-suite/v1", ExportedAt: "2026-01-01T00:00:00Z", OrganizationID: "org_old", Tables: map[string][]map[string]any{}}
	for _, table := range legacyBackupTables {
		backup.Tables[table] = []map[string]any{}
	}
	backup.Tables["erp_items"] = []map[string]any{{"id": "invalid-candidate", "organizationId": "org_old"}}
	path := filepath.Join(t.TempDir(), "before.sqlite")
	if _, err := importLegacyWithSnapshot(context.Background(), a.db, path, id, session, backup, nil, "invalid-import-key"); err == nil {
		t.Fatal("invalid candidate accepted")
	}
	var count int
	if err := a.db.QueryRow("SELECT count(*) FROM erp_items WHERE id='invalid-candidate'").Scan(&count); err != nil || count != 0 {
		t.Fatalf("partial import %d %v", count, err)
	}
	if err := a.db.QueryRow("SELECT count(*) FROM audit_events WHERE organization_id=? AND action='legacy.import'", org).Scan(&count); err != nil || count != 0 {
		t.Fatalf("unexpected audit %d %v", count, err)
	}
	snapshot, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer snapshot.Close()
	if err = snapshot.QueryRow("SELECT count(*) FROM organizations WHERE id=?", org).Scan(&count); err != nil || count != 1 {
		t.Fatalf("snapshot unavailable %d %v", count, err)
	}
}

func TestLegacyCandidateRetryAndAudit(t *testing.T) {
	a := appForTest(t)
	space := token()
	cookies := loginSite(t, a, "admin@suite.test", space, "erp")
	var session string
	for _, cookie := range cookies {
		if cookie.Name == cookieName {
			session = cookie.Value
		}
	}
	if session == "" {
		t.Fatal("missing session")
	}
	org := "org_test_" + space
	id := &Identity{OrganizationID: org, UserID: org + "_admin"}
	backup := legacyBackupPreview{Format: "business-suite/v1", ExportedAt: "2026-01-01T00:00:00Z", OrganizationID: "org_old", Tables: map[string][]map[string]any{}}
	for _, table := range legacyBackupTables {
		backup.Tables[table] = []map[string]any{}
	}
	backup.Tables["erp_items"] = []map[string]any{{"id": "retry-item", "organizationId": "org_old", "sku": "retry", "name": "Item", "unit": "PCS", "boxConversionRatio": float64(1), "category": "general", "isActive": true, "createdAt": "2026-01-01"}}
	for i := 0; i < 2; i++ {
		tx, err := a.db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		count, err := recordLegacyCandidate(tx, id, session, backup, nil, "legacy-retry-key")
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
	var auditJSON string
	if err := a.db.QueryRow("SELECT after_value FROM audit_events WHERE organization_id=? AND action='legacy.import'", org).Scan(&auditJSON); err != nil {
		t.Fatal(err)
	}
	var auditData map[string]any
	if err := json.Unmarshal([]byte(auditJSON), &auditData); err != nil || auditData["sourceOrganization"] != "org_old" || auditData["exportedAt"] != backup.ExportedAt || auditData["requestHash"] == "" || auditData["backupHash"] == "" {
		t.Fatalf("invalid audit metadata: %s %v", auditJSON, err)
	}
	counts, ok := auditData["tableCounts"].(map[string]any)
	if !ok || counts["erp_items"] != float64(1) {
		t.Fatalf("invalid table counts: %s", auditJSON)
	}
	if _, err := a.db.Exec("UPDATE station_grants SET enabled=0 WHERE user_id=? AND site='mes'", id.UserID); err != nil {
		t.Fatal(err)
	}
	revoked, err := a.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = recordLegacyCandidate(revoked, id, session, backup, nil, "legacy-retry-key"); err == nil {
		revoked.Rollback()
		t.Fatal("revoked administrator accepted on retry")
	}
	revoked.Rollback()
	if _, err = a.db.Exec("UPDATE station_grants SET enabled=1 WHERE user_id=? AND site='mes'", id.UserID); err != nil {
		t.Fatal(err)
	}
	backup.Tables["erp_items"][0]["name"] = "Changed"
	tx, err := a.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err = recordLegacyCandidate(tx, id, session, backup, nil, "legacy-retry-key"); err == nil {
		t.Fatal("changed retry accepted")
	}
}

func TestLegacyCandidateRetryIgnoresMappingOrder(t *testing.T) {
	a := appForTest(t)
	space := token()
	cookies := loginSite(t, a, "admin@suite.test", space, "crm")
	var session string
	for _, cookie := range cookies {
		if cookie.Name == cookieName {
			session = cookie.Value
		}
	}
	org := "org_test_" + space
	id := &Identity{OrganizationID: org, UserID: org + "_admin"}
	backup := legacyBackupPreview{Format: "business-suite/v1", ExportedAt: "2026-01-01T00:00:00Z", OrganizationID: "org_old", Tables: map[string][]map[string]any{}}
	for _, table := range legacyBackupTables {
		backup.Tables[table] = []map[string]any{}
	}
	backup.Tables["crm_leads"] = []map[string]any{
		{"id": "mapped-a", "organizationId": "org_old", "name": "A", "company": nil, "email": "a@example.test", "phone": nil, "status": "new", "assignedTo": "old-a", "convertedAccountId": nil, "convertedContactId": nil, "convertedOpportunityId": nil, "createdAt": "2026-01-01"},
		{"id": "mapped-b", "organizationId": "org_old", "name": "B", "company": nil, "email": "b@example.test", "phone": nil, "status": "new", "assignedTo": "old-b", "convertedAccountId": nil, "convertedContactId": nil, "convertedOpportunityId": nil, "createdAt": "2026-01-01"},
	}
	entries := []legacyMappingEntry{{Source: "old-a", Target: org + "_admin"}, {Source: "old-b", Target: org + "_office"}}
	for i := 0; i < 2; i++ {
		tx, err := a.db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		count, err := recordLegacyCandidate(tx, id, session, backup, entries, "mapping-order-key")
		if err != nil || count != 2 {
			tx.Rollback()
			t.Fatalf("attempt %d: %d %v", i, count, err)
		}
		if err = tx.Commit(); err != nil {
			t.Fatal(err)
		}
		entries[0], entries[1] = entries[1], entries[0]
	}
}
