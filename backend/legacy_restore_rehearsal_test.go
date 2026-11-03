package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func TestLegacyImportAndRestoreCandidateRehearsal(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	cookies := loginSite(t, a, "admin@suite.test", space, "erp")
	session := ""
	for _, cookie := range cookies {
		if cookie.Name == cookieName+"_erp" {
			session = cookie.Value
		}
	}
	if session == "" {
		t.Fatal("missing session")
	}
	var seq int
	var name, database string
	if err := a.db.QueryRow("PRAGMA database_list").Scan(&seq, &name, &database); err != nil {
		t.Fatal(err)
	}
	if err := a.db.Close(); err != nil {
		t.Fatal(err)
	}
	tables := map[string][]map[string]any{}
	for _, table := range legacyBackupTables {
		tables[table] = []map[string]any{}
	}
	tables["erp_items"] = []map[string]any{{"id": "rehearsal-item", "organizationId": "org_old", "sku": "REHEARSAL-ITEM", "name": "Rehearsal item", "unit": "PCS", "boxConversionRatio": 1, "category": "general", "isActive": true, "createdAt": "2026-01-01"}}
	backup := legacyBackupPreview{Format: "business-suite/v1", ExportedAt: "2026-01-01T00:00:00Z", OrganizationID: "org_old", Tables: tables}
	input := map[string]any{"organizationId": org, "userId": org + "_admin", "session": session, "confirmOrganizationId": org, "idempotencyKey": "rehearsal-import-0001", "entries": []any{}, "backup": backup}
	raw, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	var output bytes.Buffer
	if err = runLegacyImportCommand(context.Background(), database, dir, bytes.NewReader(raw), &output); err != nil {
		t.Fatalf("import: %v", err)
	}
	var result struct {
		Rows     int    `json:"rows"`
		Snapshot string `json:"snapshot"`
	}
	if err = json.Unmarshal(output.Bytes(), &result); err != nil || result.Rows != 1 || result.Snapshot == "" || filepath.Base(result.Snapshot) != result.Snapshot {
		t.Fatalf("invalid result: %v %s", err, output.String())
	}
	snapshot := filepath.Join(dir, result.Snapshot)
	candidate := filepath.Join(dir, "rehearsal-candidate.sqlite")
	if err = restoreCopyCommand(context.Background(), []string{snapshot, candidate}); err != nil {
		t.Fatalf("restore candidate: %v", err)
	}
	current, err := sql.Open("sqlite", database)
	if err != nil {
		t.Fatal(err)
	}
	defer current.Close()
	restored, err := sql.Open("sqlite", candidate)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	var currentRows, restoredRows, audits int
	if err = current.QueryRow("SELECT count(*) FROM erp_items WHERE organization_id=? AND id='rehearsal-item'", org).Scan(&currentRows); err != nil {
		t.Fatal(err)
	}
	if err = restored.QueryRow("SELECT count(*) FROM erp_items WHERE organization_id=? AND id='rehearsal-item'", org).Scan(&restoredRows); err != nil {
		t.Fatal(err)
	}
	if err = current.QueryRow("SELECT count(*) FROM audit_events WHERE organization_id=? AND action='legacy.import'", org).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if currentRows != 1 || restoredRows != 0 || audits != 1 {
		t.Fatalf("current=%d restored=%d audits=%d", currentRows, restoredRows, audits)
	}
	if err = current.Close(); err != nil {
		t.Fatal(err)
	}
	output.Reset()
	if err = runLegacyImportCommand(context.Background(), database, dir, strings.NewReader(string(raw)), &output); err != nil {
		t.Fatalf("retry: %v", err)
	}
	check, err := sql.Open("sqlite", database)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	if err = check.QueryRow("SELECT count(*) FROM erp_items WHERE organization_id=? AND id='rehearsal-item'", org).Scan(&currentRows); err != nil || currentRows != 1 {
		t.Fatalf("duplicate after retry: %d %v", currentRows, err)
	}
}
