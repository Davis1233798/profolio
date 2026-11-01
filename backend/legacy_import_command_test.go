package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLegacyImportCommandValidatesInputAndProtectsSecrets(t *testing.T) {
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
	dir := t.TempDir()
	org := "org_test_" + space
	tables := map[string][]map[string]any{}
	for _, table := range legacyBackupTables {
		tables[table] = []map[string]any{}
	}
	backup := legacyBackupPreview{Format: "business-suite/v1", ExportedAt: "2026-01-01T00:00:00Z", OrganizationID: "org_old", Tables: tables}
	input := map[string]any{"organizationId": org, "userId": org + "_admin", "session": session, "confirmOrganizationId": org, "idempotencyKey": "command-test-key", "entries": []any{}, "backup": backup}
	marshal := func(v any) string {
		raw, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		return string(raw)
	}
	valid := marshal(input)
	checkRejected := func(raw, db, outputDir string) {
		t.Helper()
		var out bytes.Buffer
		err := runLegacyImportCommand(context.Background(), db, outputDir, strings.NewReader(raw), &out)
		if err == nil {
			t.Fatal("invalid command accepted")
		}
		if strings.Contains(fmt.Sprint(err), session) || strings.Contains(out.String(), session) || strings.Contains(out.String(), "org_old") {
			t.Fatal("command exposed sensitive input")
		}
	}
	input["confirmOrganizationId"] = "org_other"
	checkRejected(marshal(input), database, dir)
	input["confirmOrganizationId"] = org
	input["unknown"] = true
	checkRejected(marshal(input), database, dir)
	delete(input, "unknown")
	checkRejected(valid+" {}", database, dir)
	checkRejected(strings.Repeat(" ", 5000001), database, dir)
	input["session"] = ""
	checkRejected(marshal(input), database, dir)
	checkRejected(valid, "", dir)
	checkRejected(valid, database, filepath.Join(dir, "missing"))
	var out bytes.Buffer
	if err := runLegacyImportCommand(context.Background(), database, dir, strings.NewReader(valid), &out); err != nil {
		t.Fatal(err)
	}
	var result struct {
		Rows     int    `json:"rows"`
		Snapshot string `json:"snapshot"`
	}
	if err := json.Unmarshal(out.Bytes(), &result); err != nil || result.Rows != 0 || result.Snapshot == "" || filepath.Base(result.Snapshot) != result.Snapshot {
		t.Fatalf("invalid result: %v", err)
	}
	if strings.Contains(out.String(), session) || strings.Contains(out.String(), "org_old") || strings.Contains(out.String(), dir) {
		t.Fatal("success output exposed input or server path")
	}
	if _, err := os.Stat(filepath.Join(dir, result.Snapshot)); err != nil {
		t.Fatalf("snapshot missing: %v", err)
	}
}
