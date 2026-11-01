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
