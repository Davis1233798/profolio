package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestLegacyStagingValidatesSchemaAndDoesNotPersist(t *testing.T) {
	data := map[string][]map[string]any{}
	for _, table := range legacyBackupTables {
		data[table] = []map[string]any{}
	}
	data["erp_items"] = []map[string]any{{"id": "i", "organizationId": "org_test_target", "sku": "I", "name": "Item", "unit": "PCS", "boxConversionRatio": float64(1), "category": "general", "isActive": true, "createdAt": "2026-01-01"}}
	if count, err := stageLegacyRows(data); err != nil || count != 1 {
		t.Fatalf("stage %d %v", count, err)
	}
	delete(data["erp_items"][0], "unit")
	if _, err := stageLegacyRows(data); err == nil {
		t.Fatal("missing column accepted")
	}
	data["erp_items"][0]["unit"] = "PCS"
	data["erp_items"][0]["isActive"] = nil
	if _, err := stageLegacyRows(data); err == nil {
		t.Fatal("null required field accepted")
	}
	delete(data, "shop_reviews")
	if _, err := stageLegacyRows(data); err == nil {
		t.Fatal("incomplete manifest accepted")
	}
}

func TestLegacyInsertRollsBackOnConstraintFailure(t *testing.T) {
	a := appForTest(t)
	data := map[string][]map[string]any{}
	for _, table := range legacyBackupTables {
		data[table] = []map[string]any{}
	}
	item := map[string]any{"id": "rollback-item", "organizationId": "org_test_target", "sku": "I", "name": "Item", "unit": "PCS", "boxConversionRatio": float64(1), "category": "general", "isActive": true, "createdAt": "2026-01-01"}
	data["erp_items"] = []map[string]any{item, item}
	tx, err := a.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = insertLegacyRows(tx, data); err == nil {
		tx.Rollback()
		t.Fatal("duplicate insert accepted")
	}
	if err = tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = a.db.QueryRow("SELECT count(*) FROM erp_items WHERE id='rollback-item'").Scan(&count); err != nil || count != 0 {
		t.Fatalf("partial data survived: %d %v", count, err)
	}
}

func TestLegacyStagingWithBusinessFixtures(t *testing.T) {
	raw, err := migrations.ReadFile("migrations/fixtures.json")
	if err != nil {
		t.Fatal(err)
	}
	var source map[string][]map[string]any
	if err = json.Unmarshal(raw, &source); err != nil {
		t.Fatal(err)
	}
	backup := legacyBackupPreview{OrganizationID: "org_old", Tables: map[string][]map[string]any{}}
	for _, table := range legacyBackupTables {
		backup.Tables[table] = []map[string]any{}
		for _, original := range source[table] {
			row := map[string]any{}
			for column, value := range original {
				key := camel(column)
				if text, ok := value.(string); ok {
					value = strings.ReplaceAll(text, "org_go_fixture", "org_old")
				}
				if legacyBooleanFields[table+"."+key] && value != nil {
					n, ok := value.(float64)
					if !ok || (n != 0 && n != 1) {
						t.Fatalf("invalid fixture boolean %s.%s", table, key)
					}
					value = n == 1
				}
				row[key] = value
			}
			// Fixtures include an open POS shift for interactive demos; the
			// migration candidate represents a workspace after operations stop.
			if table == "pos_shifts" && row["status"] == "open" {
				row["status"] = "closed"
			}
			backup.Tables[table] = append(backup.Tables[table], row)
		}
	}
	used := map[string]bool{}
	for table, rows := range backup.Tables {
		for _, row := range rows {
			for _, field := range legacyIdentityFields[table] {
				if value, ok := row[field].(string); ok && value != "" && !(table == "shop_inventory_reservations" && field == "sessionId" && !isLegacyDemoIdentity(value, backup.OrganizationID)) {
					used[value] = true
				}
			}
		}
	}
	var mappings []legacyMappingEntry
	for id := range used {
		mappings = append(mappings, legacyMappingEntry{Source: id, Target: "station_" + id})
	}
	prepared, err := prepareLegacyRows(backup, "org_test_fixture", mappings)
	if err != nil {
		t.Fatal(err)
	}
	count, err := stageLegacyRows(prepared)
	if err != nil || count == 0 {
		t.Fatalf("business fixtures: %d %v", count, err)
	}
}
