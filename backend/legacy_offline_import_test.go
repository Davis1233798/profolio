package main

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"
)

func TestLegacyOfflineImportLockSnapshotAndAuthorization(t *testing.T) {
	a := appForTest(t)
	space := token()
	cookies := loginSite(t, a, "admin@suite.test", space, "erp")
	var session string
	for _, cookie := range cookies {
		if cookie.Name == cookieName+"_erp" {
			session = cookie.Value
		}
	}
	if session == "" {
		t.Fatal("missing station session")
	}
	var seq int
	var name, database string
	if err := a.db.QueryRow("PRAGMA database_list").Scan(&seq, &name, &database); err != nil {
		t.Fatal(err)
	}
	if err := a.db.Close(); err != nil {
		t.Fatal(err)
	}
	org := "org_test_" + space
	id := &Identity{OrganizationID: org, UserID: org + "_admin"}
	backup := legacyBackupPreview{Format: "business-suite/v1", ExportedAt: "2026-01-01T00:00:00Z", OrganizationID: "org_old", Tables: map[string][]map[string]any{}}
	for _, table := range legacyBackupTables {
		backup.Tables[table] = []map[string]any{}
	}
	backup.Tables["erp_items"] = []map[string]any{{"id": "offline-item", "organizationId": "org_old", "sku": "offline-item", "name": "Item", "unit": "PCS", "boxConversionRatio": float64(1), "category": "general", "isActive": true, "createdAt": "2026-01-01"}}
	dir := t.TempDir()
	lockedSnapshot := filepath.Join(dir, "locked.sqlite")
	release, err := acquireMaintenanceLock(database)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = offlineImportLegacy(context.Background(), database, lockedSnapshot, id, session, backup, nil, "offline-lock-key"); err == nil {
		release()
		t.Fatal("import accepted while station holds lock")
	}
	if _, err = os.Stat(lockedSnapshot); !os.IsNotExist(err) {
		release()
		t.Fatal("snapshot created despite held maintenance lock")
	}
	if err = release(); err != nil {
		t.Fatal(err)
	}
	failedSnapshot := filepath.Join(dir, "failed.sqlite")
	if _, err = offlineImportLegacy(context.Background(), database, failedSnapshot, id, "invalid", backup, nil, "offline-fail-key"); err == nil {
		t.Fatal("invalid session accepted")
	}
	if _, err = os.Stat(failedSnapshot); err != nil {
		t.Fatalf("failure snapshot missing: %v", err)
	}
	snapshot := filepath.Join(dir, "before.sqlite")
	if count, err := offlineImportLegacy(context.Background(), database, snapshot, id, session, backup, nil, "offline-success-key"); err != nil || count != 1 {
		t.Fatalf("import %d: %v", count, err)
	}
	if _, err = os.Stat(snapshot); err != nil {
		t.Fatalf("success snapshot missing: %v", err)
	}
	if count, err := offlineImportLegacy(context.Background(), database, filepath.Join(dir, "retry.sqlite"), id, session, backup, nil, "offline-success-key"); err != nil || count != 1 {
		t.Fatalf("idempotent retry %d: %v", count, err)
	}
	current, err := sql.Open("sqlite", database)
	if err != nil {
		t.Fatal(err)
	}
	defer current.Close()
	var rows, audit int
	if err = current.QueryRow("SELECT count(*) FROM erp_items WHERE organization_id=? AND id='offline-item'", org).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if err = current.QueryRow("SELECT count(*) FROM audit_events WHERE organization_id=? AND action='legacy.import'", org).Scan(&audit); err != nil || rows != 1 || audit != 1 {
		t.Fatalf("retry duplicated records: rows=%d audit=%d err=%v", rows, audit, err)
	}
	before, err := sql.Open("sqlite", snapshot)
	if err != nil {
		t.Fatal(err)
	}
	defer before.Close()
	if err = before.QueryRow("SELECT count(*) FROM erp_items WHERE id='offline-item'").Scan(&rows); err != nil || rows != 0 {
		t.Fatalf("snapshot contains imported row: %d %v", rows, err)
	}
	if release, err = acquireMaintenanceLock(database); err != nil {
		t.Fatalf("lock not released after import: %v", err)
	} else if err = release(); err != nil {
		t.Fatal(err)
	}
}

func TestLegacyOfflineImportDoesNotCreateMissingDatabase(t *testing.T) {
	dir := t.TempDir()
	database := filepath.Join(dir, "missing.sqlite")
	_, err := offlineImportLegacy(context.Background(), database, filepath.Join(dir, "snapshot.sqlite"), &Identity{}, "", legacyBackupPreview{}, nil, "missing-db-key")
	if err == nil {
		t.Fatal("missing database accepted")
	}
	if _, err = os.Stat(database); !os.IsNotExist(err) {
		t.Fatal("missing database was created")
	}
	invalid := filepath.Join(dir, "invalid.sqlite")
	if err = os.WriteFile(invalid, []byte("not sqlite"), 0600); err != nil {
		t.Fatal(err)
	}
	snapshot := filepath.Join(dir, "invalid-snapshot.sqlite")
	if _, err = offlineImportLegacy(context.Background(), invalid, snapshot, &Identity{}, "", legacyBackupPreview{}, nil, "invalid-db-key"); err == nil {
		t.Fatal("invalid database accepted")
	}
	if data, err := os.ReadFile(invalid); err != nil || string(data) != "not sqlite" {
		t.Fatal("invalid database was changed")
	}
	if _, err = os.Stat(snapshot); !os.IsNotExist(err) {
		t.Fatal("snapshot created for invalid database")
	}
}
