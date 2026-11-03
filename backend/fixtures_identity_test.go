package main

import "testing"

func TestFixtureIdentityReferencesUseStationAccounts(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	admin := loginSite(t, a, "admin@suite.test", space, "crm")
	for table, fields := range fixtureIdentityColumns {
		for field := range fields {
			var count int
			query := "SELECT count(*) FROM " + table + " WHERE organization_id=? AND " + field + " LIKE ?"
			if err := a.db.QueryRow(query, org, "usr_"+org+"_%").Scan(&count); err != nil {
				t.Fatal(err)
			}
			if count != 0 {
				t.Fatalf("%s.%s retains %d legacy demo identities", table, field, count)
			}
		}
	}
	var lead, assigned string
	if err := a.db.QueryRow("SELECT id,assigned_to FROM crm_leads WHERE organization_id=? LIMIT 1", org).Scan(&lead, &assigned); err != nil {
		t.Fatal(err)
	}
	if assigned != org+"_admin" {
		t.Fatalf("seeded lead assignee %q", assigned)
	}
	w := request(a, "POST", "/api/stations/crm/business", map[string]any{"action": "convert", "leadId": lead, "idempotencyKey": "seeded-lead-conversion"}, admin...)
	if w.Code != 200 {
		t.Fatalf("seeded lead conversion %d %s", w.Code, w.Body.String())
	}
}
