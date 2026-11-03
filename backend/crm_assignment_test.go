package main

import "testing"

func TestCRMAssignmentAuthorityAndRetry(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	admin := loginSite(t, a, "admin@suite.test", space, "crm")
	front := loginSite(t, a, "front@suite.test", space, "crm")
	other := loginSite(t, a, "admin@suite.test", token(), "crm")
	var lead string
	if err := a.db.QueryRow("SELECT id FROM crm_leads WHERE organization_id=? LIMIT 1", org).Scan(&lead); err != nil {
		t.Fatal(err)
	}
	path := "/api/stations/crm/assign-lead"
	input := map[string]any{"leadId": lead, "userId": org + "_office", "idempotencyKey": "assign-lead-test-1"}
	if w := request(a, "POST", path, input, front...); w.Code != 403 {
		t.Fatalf("front: %d", w.Code)
	}
	if w := request(a, "POST", path, input, other...); w.Code != 409 {
		t.Fatalf("foreign target: %d", w.Code)
	}
	if w := request(a, "POST", path, input, admin...); w.Code != 200 {
		t.Fatalf("assign: %d %s", w.Code, w.Body.String())
	}
	if w := request(a, "POST", path, input, admin...); w.Code != 200 {
		t.Fatalf("retry: %d", w.Code)
	}
	var assigned string
	if err := a.db.QueryRow("SELECT assigned_to FROM crm_leads WHERE organization_id=? AND id=?", org, lead).Scan(&assigned); err != nil || assigned != org+"_office" {
		t.Fatalf("assignee %q %v", assigned, err)
	}
	var audits int
	if err := a.db.QueryRow("SELECT count(*) FROM audit_events WHERE organization_id=? AND action='crm.assign' AND entity_id=?", org, lead).Scan(&audits); err != nil || audits != 1 {
		t.Fatalf("audit %d %v", audits, err)
	}
	input["userId"] = org + "_front"
	if w := request(a, "POST", path, input, admin...); w.Code != 409 {
		t.Fatalf("changed retry: %d", w.Code)
	}
}
