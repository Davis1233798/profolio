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
