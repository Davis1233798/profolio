package main

import (
	"fmt"
	"sync"
	"testing"
)

func TestCRMLeadConversionIsAtomicAndTenantScoped(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	operator := loginSite(t, a, "front@suite.test", space, "crm")
	viewer := loginSite(t, a, "viewer@suite.test", space, "crm")
	other := loginSite(t, a, "admin@suite.test", token(), "crm")
	path := "/api/stations/crm/business"
	create := map[string]any{"action": "create", "name": "Sample Lead", "company": "Example Company", "email": "lead@example.test", "idempotencyKey": "crm-create-key-1"}
	if w := request(a, "POST", path, create, viewer...); w.Code != 403 {
		t.Fatalf("readonly %d", w.Code)
	}
	if w := request(a, "POST", path, create, operator...); w.Code != 200 {
		t.Fatalf("create %d %s", w.Code, w.Body.String())
	}
	if w := request(a, "POST", path, create, operator...); w.Code != 200 {
		t.Fatalf("retry %d", w.Code)
	}
	changed := map[string]any{"action": "create", "name": "Other Lead", "email": "other@example.test", "idempotencyKey": "crm-create-key-1"}
	if w := request(a, "POST", path, changed, operator...); w.Code != 409 {
		t.Fatalf("changed retry %d", w.Code)
	}
	duplicate := map[string]any{"action": "create", "name": "Duplicate", "email": "LEAD@example.test", "idempotencyKey": "crm-create-key-2"}
	if w := request(a, "POST", path, duplicate, operator...); w.Code != 409 {
		t.Fatalf("duplicate %d", w.Code)
	}
	var lead string
	if e := a.db.QueryRow("SELECT id FROM crm_leads WHERE organization_id=? AND email=?", org, "lead@example.test").Scan(&lead); e != nil {
		t.Fatal(e)
	}
	input := func(i int) map[string]any {
		return map[string]any{"action": "convert", "leadId": lead, "amount": 10000, "idempotencyKey": fmt.Sprintf("crm-convert-%08d", i)}
	}
	if w := request(a, "POST", path, input(99), other...); w.Code != 404 {
		t.Fatalf("foreign lead %d", w.Code)
	}
	var wg sync.WaitGroup
	results := make(chan int, 16)
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func(i int) { defer wg.Done(); results <- request(a, "POST", path, input(i), operator...).Code }(i)
	}
	wg.Wait()
	close(results)
	for code := range results {
		if code != 200 {
			t.Errorf("conversion returned %d", code)
		}
	}
	var accounts, contacts, opps int
	a.db.QueryRow("SELECT count(*) FROM crm_accounts WHERE organization_id=? AND email=?", org, "lead@example.test").Scan(&accounts)
	a.db.QueryRow("SELECT count(*) FROM crm_contacts WHERE organization_id=? AND email=?", org, "lead@example.test").Scan(&contacts)
	a.db.QueryRow("SELECT count(*) FROM crm_opportunities WHERE organization_id=? AND name=?", org, "Example Company opportunity").Scan(&opps)
	if accounts != 1 || contacts != 1 || opps != 1 {
		t.Fatalf("conversion duplicates: %d %d %d", accounts, contacts, opps)
	}
}

func TestCRMLeadConversionPreservesAssignedOwner(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	admin := loginSite(t, a, "admin@suite.test", space, "crm")
	loginSite(t, a, "office@suite.test", space, "crm")
	owner := org + "_office"
	for _, lead := range []string{"assigned-lead", "disabled-lead"} {
		if _, err := a.db.Exec("INSERT INTO crm_leads(id,organization_id,name,email,status,assigned_to) VALUES(?,?,?,?,'new',?)", lead, org, lead, lead+"@example.test", owner); err != nil {
			t.Fatal(err)
		}
	}
	path := "/api/stations/crm/business"
	convert := func(lead string) map[string]any {
		return map[string]any{"action": "convert", "leadId": lead, "idempotencyKey": "convert-" + lead}
	}
	if w := request(a, "POST", path, convert("assigned-lead"), admin...); w.Code != 200 {
		t.Fatalf("conversion %d %s", w.Code, w.Body.String())
	}
	var accountOwner, opportunityOwner string
	if err := a.db.QueryRow("SELECT a.owner_id,o.owner_id FROM crm_leads l JOIN crm_accounts a ON a.id=l.converted_account_id AND a.organization_id=l.organization_id JOIN crm_opportunities o ON o.id=l.converted_opportunity_id AND o.organization_id=l.organization_id WHERE l.id=? AND l.organization_id=?", "assigned-lead", org).Scan(&accountOwner, &opportunityOwner); err != nil {
		t.Fatal(err)
	}
	if accountOwner != owner || opportunityOwner != owner {
		t.Fatalf("owners %q %q", accountOwner, opportunityOwner)
	}
	if _, err := a.db.Exec("UPDATE station_grants SET enabled=0 WHERE user_id=? AND site='crm'", owner); err != nil {
		t.Fatal(err)
	}
	if w := request(a, "POST", path, convert("disabled-lead"), admin...); w.Code != 409 {
		t.Fatalf("disabled assignee %d %s", w.Code, w.Body.String())
	}
	var status string
	if err := a.db.QueryRow("SELECT status FROM crm_leads WHERE id=? AND organization_id=?", "disabled-lead", org).Scan(&status); err != nil || status != "new" {
		t.Fatalf("lead changed: %q %v", status, err)
	}
}
