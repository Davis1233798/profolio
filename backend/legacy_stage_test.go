package main

import "testing"

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
