package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// This is a fixture rehearsal, not complete coverage of legacy transactions:
// tables absent from migrations/fixtures.json are supplied as empty arrays.
func TestLegacyFixtureRehearsalImportRestoreAndRetry(t *testing.T) {
	a := appForTest(t)
	space := token()
	organization := "org_test_" + space
	sourceOrganization := "org_fixture_rehearsal_" + token()
	cookies := loginSite(t, a, "admin@suite.test", space, "erp")
	var session string
	for _, cookie := range cookies {
		if cookie.Name == cookieName+"_erp" {
			session = cookie.Value
		}
	}
	if session == "" {
		t.Fatal("missing ERP station session")
	}

	// Use real, enabled target accounts returned by the existing migration UI API.
	accountsResponse := request(a, "GET", "/api/stations/erp/legacy-mapping-accounts", nil, cookies...)
	if accountsResponse.Code != 200 {
		t.Fatalf("mapping accounts %d: %s", accountsResponse.Code, accountsResponse.Body.String())
	}
	var accounts struct {
		Data []struct {
			UserID string `json:"userId"`
			Email  string `json:"email"`
		} `json:"data"`
	}
	if err := json.Unmarshal(accountsResponse.Body.Bytes(), &accounts); err != nil {
		t.Fatal(err)
	}
	accountByEmail := map[string]string{}
	for _, account := range accounts.Data {
		accountByEmail[account.Email] = account.UserID
	}
	adminTarget, operatorTarget := accountByEmail["admin@suite.test"], accountByEmail["front@suite.test"]
	if adminTarget == "" || operatorTarget == "" {
		t.Fatalf("real admin/front account mapping unavailable: %#v", accountByEmail)
	}

	backup := legacyFixtureRehearsalBackup(t, sourceOrganization)
	identitySources := map[string]bool{}
	for table, rows := range backup.Tables {
		for _, row := range rows {
			for _, field := range legacyIdentityFields[table] {
				value, ok := row[field].(string)
				if !ok || value == "" || (table == "shop_inventory_reservations" && field == "sessionId" && !isLegacyDemoIdentity(value, sourceOrganization)) {
					continue
				}
				identitySources[value] = true
			}
		}
	}
	sources := make([]string, 0, len(identitySources))
	for source := range identitySources {
		sources = append(sources, source)
	}
	sort.Strings(sources)
	entries := make([]legacyMappingEntry, 0, len(sources))
	for _, source := range sources {
		target := ""
		switch {
		case strings.HasSuffix(source, "_admin"):
			target = adminTarget
		case strings.HasSuffix(source, "_op"):
			target = operatorTarget
		default:
			t.Fatalf("fixture rehearsal needs an explicit real-account mapping for %q", source)
		}
		entries = append(entries, legacyMappingEntry{Source: source, Target: target})
	}
	if len(entries) == 0 {
		t.Fatal("fixture rehearsal unexpectedly has no account references")
	}

	baseline := map[string]int{}
	for _, table := range legacyBackupTables {
		var count int
		if err := a.db.QueryRow("SELECT count(*) FROM \""+table+"\" WHERE organization_id=?", organization).Scan(&count); err != nil {
			t.Fatalf("baseline %s: %v", table, err)
		}
		baseline[table] = count
	}
	var seq int
	var dbName, database string
	if err := a.db.QueryRow("PRAGMA database_list").Scan(&seq, &dbName, &database); err != nil {
		t.Fatal(err)
	}
	if database == "" {
		t.Fatal("fixture rehearsal requires an on-disk destination")
	}
	if err := a.db.Close(); err != nil {
		t.Fatal(err)
	}

	importInput := struct {
		OrganizationID string               `json:"organizationId"`
		UserID         string               `json:"userId"`
		Session        string               `json:"session"`
		Confirm        string               `json:"confirmOrganizationId"`
		Key            string               `json:"idempotencyKey"`
		Entries        []legacyMappingEntry `json:"entries"`
		Backup         legacyBackupPreview  `json:"backup"`
	}{
		OrganizationID: organization,
		UserID:         adminTarget,
		Session:        session,
		Confirm:        organization,
		Key:            "fixture-rehearsal-import-0001",
		Entries:        entries,
		Backup:         backup,
	}
	raw, err := json.Marshal(importInput)
	if err != nil {
		t.Fatal(err)
	}
	backupDir := t.TempDir()
	var output bytes.Buffer
	if err := runLegacyImportCommand(context.Background(), database, backupDir, bytes.NewReader(raw), &output); err != nil {
		t.Fatalf("fixture rehearsal import: %v", err)
	}
	var result struct {
		Rows     int    `json:"rows"`
		Snapshot string `json:"snapshot"`
	}
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatalf("import result: %v (%s)", err, output.String())
	}
	expectedRows := 0
	for _, rows := range backup.Tables {
		expectedRows += len(rows)
	}
	if result.Rows != expectedRows || result.Snapshot == "" || filepath.Base(result.Snapshot) != result.Snapshot {
		t.Fatalf("unexpected import result: rows=%d expected=%d snapshot=%q", result.Rows, expectedRows, result.Snapshot)
	}

	candidatePath := filepath.Join(backupDir, "fixture-rehearsal-before.sqlite")
	if err := restoreCopyCommand(context.Background(), []string{filepath.Join(backupDir, result.Snapshot), candidatePath}); err != nil {
		t.Fatalf("restore-copy pre-import snapshot: %v", err)
	}
	current, err := sql.Open("sqlite", database)
	if err != nil {
		t.Fatal(err)
	}
	defer current.Close()
	candidate, err := sql.Open("sqlite", candidatePath)
	if err != nil {
		t.Fatal(err)
	}
	defer candidate.Close()

	for _, table := range legacyBackupTables {
		var liveCount, candidateCount int
		if err := current.QueryRow("SELECT count(*) FROM \""+table+"\" WHERE organization_id=?", organization).Scan(&liveCount); err != nil {
			t.Fatalf("live count %s: %v", table, err)
		}
		if err := candidate.QueryRow("SELECT count(*) FROM \""+table+"\" WHERE organization_id=?", organization).Scan(&candidateCount); err != nil {
			t.Fatalf("candidate count %s: %v", table, err)
		}
		expected := baseline[table] + len(backup.Tables[table])
		if liveCount != expected || candidateCount != baseline[table] {
			t.Fatalf("%s counts live=%d expected=%d candidate=%d baseline=%d", table, liveCount, expected, candidateCount, baseline[table])
		}
	}

	fixtureID := func(table string) string {
		t.Helper()
		rows := backup.Tables[table]
		if len(rows) == 0 {
			t.Fatalf("fixture rehearsal has no representative %s row", table)
		}
		id, ok := rows[0]["id"].(string)
		if !ok || id == "" {
			t.Fatalf("fixture rehearsal %s row has no ID", table)
		}
		return id
	}
	assertCount := func(label, query string, args ...any) {
		t.Helper()
		var count int
		if err := current.QueryRow(query, args...).Scan(&count); err != nil || count != 1 {
			t.Fatalf("%s representative record count=%d err=%v", label, count, err)
		}
	}
	assertCount("MES work order", `SELECT count(*) FROM mes_work_orders w JOIN mes_products p ON p.organization_id=w.organization_id AND p.id=w.product_id WHERE w.organization_id=? AND w.id=?`, organization, fixtureID("mes_work_orders"))
	assertCount("ERP stock ledger", `SELECT count(*) FROM erp_stock_ledger l JOIN erp_items i ON i.organization_id=l.organization_id AND i.id=l.item_id JOIN erp_warehouses w ON w.organization_id=l.organization_id AND w.id=l.warehouse_id WHERE l.organization_id=? AND l.id=?`, organization, fixtureID("erp_stock_ledger"))
	assertCount("POS mapped cashier", `SELECT count(*) FROM pos_shifts WHERE organization_id=? AND id=? AND cashier_id=? AND status='closed'`, organization, fixtureID("pos_shifts"), operatorTarget)
	assertCount("CRM mapped account owner", `SELECT count(*) FROM crm_accounts a JOIN crm_opportunities o ON o.organization_id=a.organization_id AND o.account_id=a.id WHERE a.organization_id=? AND a.id=? AND a.owner_id=?`, organization, fixtureID("crm_accounts"), adminTarget)
	assertCount("dining order session", `SELECT count(*) FROM dining_orders o JOIN dining_table_sessions s ON s.organization_id=o.organization_id AND s.id=o.session_id WHERE o.organization_id=? AND o.id=?`, organization, fixtureID("dining_orders"))
	assertCount("shop order line", `SELECT count(*) FROM shop_orders o JOIN shop_order_items i ON i.organization_id=o.organization_id AND i.order_id=o.id WHERE o.organization_id=? AND o.id=? AND o.payment_status='paid'`, organization, fixtureID("shop_orders"))

	// Retry the exact command payload: imported row counts and its single audit/key must remain unchanged.
	output.Reset()
	if err := runLegacyImportCommand(context.Background(), database, backupDir, bytes.NewReader(raw), &output); err != nil {
		t.Fatalf("fixture rehearsal idempotent retry: %v", err)
	}
	var retry struct {
		Rows int `json:"rows"`
	}
	if err := json.Unmarshal(output.Bytes(), &retry); err != nil || retry.Rows != expectedRows {
		t.Fatalf("retry result rows=%d err=%v", retry.Rows, err)
	}
	for _, table := range legacyBackupTables {
		var liveCount int
		if err := current.QueryRow("SELECT count(*) FROM \""+table+"\" WHERE organization_id=?", organization).Scan(&liveCount); err != nil || liveCount != baseline[table]+len(backup.Tables[table]) {
			t.Fatalf("retry duplicated %s rows: count=%d err=%v", table, liveCount, err)
		}
	}
	var audits, keys int
	if err := current.QueryRow("SELECT count(*) FROM audit_events WHERE organization_id=? AND action='legacy.import' AND entity_id=?", organization, organization).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if err := current.QueryRow("SELECT count(*) FROM idempotency_keys WHERE organization_id=? AND key=? AND endpoint='/station/legacy-import'", organization, importInput.Key).Scan(&keys); err != nil {
		t.Fatal(err)
	}
	if audits != 1 || keys != 1 {
		t.Fatalf("retry duplicated import audit/idempotency: audits=%d keys=%d", audits, keys)
	}
}

func legacyFixtureRehearsalBackup(t *testing.T, sourceOrganization string) legacyBackupPreview {
	t.Helper()
	raw, err := migrations.ReadFile("migrations/fixtures.json")
	if err != nil {
		t.Fatal(err)
	}
	var source map[string][]map[string]any
	if err := json.Unmarshal(raw, &source); err != nil {
		t.Fatal(err)
	}
	tables := make(map[string][]map[string]any, len(legacyBackupTables))
	for _, table := range legacyBackupTables {
		tables[table] = make([]map[string]any, 0, len(source[table]))
		for _, original := range source[table] {
			row := make(map[string]any, len(original))
			for column, value := range original {
				key := camel(column)
				if text, ok := value.(string); ok {
					value = strings.ReplaceAll(text, "org_go_fixture", sourceOrganization)
				}
				if legacyBooleanFields[table+"."+key] && value != nil {
					n, ok := value.(float64)
					if !ok || (n != 0 && n != 1) {
						t.Fatalf("invalid fixture boolean %s.%s: %v", table, key, value)
					}
					value = n == 1
				}
				row[key] = value
			}
			// This fixture is a synthetic stopped workspace; close its demo-only open shift.
			if table == "pos_shifts" && row["status"] == "open" {
				row["status"] = "closed"
			}
			tables[table] = append(tables[table], row)
		}
	}
	return legacyBackupPreview{
		Format:         "business-suite/v1",
		OrganizationID: sourceOrganization,
		ExportedAt:     "2026-11-03T00:00:00Z",
		Tables:         tables,
	}
}
