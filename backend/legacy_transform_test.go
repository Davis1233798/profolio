package main

import "testing"

func TestPrepareLegacyRowsPreservesSourceAndOpaqueSessions(t *testing.T) {
	backup := legacyBackupPreview{OrganizationID: "org_old", Tables: map[string][]map[string]any{
		"crm_leads":                   {{"id": "lead", "organizationId": "org_old", "assignedTo": "old-user", "name": "old-user"}},
		"shop_inventory_reservations": {{"id": "reservation", "organizationId": "org_old", "sessionId": "opaque-session"}},
	}}
	rows, err := prepareLegacyRows(backup, "org_test_new", []legacyMappingEntry{{Source: "old-user", Target: "new-user"}})
	if err != nil {
		t.Fatal(err)
	}
	lead := rows["crm_leads"][0]
	if lead["assignedTo"] != "new-user" || lead["organizationId"] != "org_test_new" || lead["name"] != "old-user" {
		t.Fatalf("transformed row: %#v", lead)
	}
	if rows["shop_inventory_reservations"][0]["sessionId"] != "opaque-session" {
		t.Fatal("opaque session changed")
	}
	if backup.Tables["crm_leads"][0]["assignedTo"] != "old-user" || backup.Tables["crm_leads"][0]["organizationId"] != "org_old" {
		t.Fatal("source modified")
	}
	if _, err = prepareLegacyRows(backup, "org_test_new", nil); err == nil {
		t.Fatal("missing mapping accepted")
	}
	if _, err = prepareLegacyRows(backup, "org_test_new", []legacyMappingEntry{{Source: "old-user", Target: "new-user"}, {Source: "unused", Target: "new-user"}}); err == nil {
		t.Fatal("unused mapping accepted")
	}
	backup.Tables["crm_leads"][0]["organizationId"] = "org_foreign"
	if _, err = prepareLegacyRows(backup, "org_test_new", []legacyMappingEntry{{Source: "old-user", Target: "new-user"}}); err == nil {
		t.Fatal("foreign row accepted")
	}
}
