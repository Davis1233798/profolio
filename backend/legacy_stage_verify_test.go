package main

import "testing"

func TestLegacyStoredValuesCompareSQLiteTypes(t *testing.T) {
	for _, test := range []struct {
		expected, actual any
		equal            bool
	}{
		{true, int64(1), true}, {false, int64(0), true}, {true, int64(2), false},
		{float64(12), int64(12), true}, {float64(12), int64(13), false},
		{"text", "text", true}, {nil, nil, true}, {nil, "", false},
	} {
		if legacyValueEqual(test.expected, test.actual) != test.equal {
			t.Fatalf("comparison %#v %#v", test.expected, test.actual)
		}
	}
}

func TestLegacyStoredRowsDetectsChangedValue(t *testing.T) {
	a := appForTest(t)
	data := map[string][]map[string]any{}
	for _, table := range legacyBackupTables {
		data[table] = []map[string]any{}
	}
	row := map[string]any{"id": "verify-item", "organizationId": "org_test_target", "sku": "SKU", "name": "Item", "unit": "PCS", "boxConversionRatio": float64(1), "category": "general", "isActive": true, "createdAt": "2026-01-01"}
	data["erp_items"] = []map[string]any{row}
	tx, err := a.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err = tx.Exec("INSERT INTO erp_items(id,organization_id,sku,name) VALUES('existing','another_org','OTHER','Existing')"); err != nil {
		t.Fatal(err)
	}
	if _, err = insertLegacyRows(tx, data); err != nil {
		t.Fatal(err)
	}
	if err = verifyLegacyStoredRows(tx, data); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec("UPDATE erp_items SET name='Changed' WHERE id='verify-item'"); err != nil {
		t.Fatal(err)
	}
	if err = verifyLegacyStoredRows(tx, data); err == nil {
		t.Fatal("changed value was not detected")
	}
	row["organizationId"] = "another_org"
	if err = verifyLegacyStoredRows(tx, data); err == nil {
		t.Fatal("wrong organization accepted")
	}
}
