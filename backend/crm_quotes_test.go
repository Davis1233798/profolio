package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"testing"
)

func TestCRMQuoteVersionsAndApproval(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	admin := loginSite(t, a, "admin@suite.test", space, "crm")
	office := loginSite(t, a, "office@suite.test", space, "crm")
	front := loginSite(t, a, "front@suite.test", space, "crm")
	viewer := loginSite(t, a, "viewer@suite.test", space, "crm")
	other := loginSite(t, a, "admin@suite.test", token(), "crm")
	path := "/api/stations/crm/quotes"
	var opp string
	if e := a.db.QueryRow("SELECT id FROM crm_opportunities WHERE organization_id=? LIMIT 1", org).Scan(&opp); e != nil {
		t.Fatal(e)
	}
	var identity struct {
		Data Identity `json:"data"`
	}
	if e := json.Unmarshal(request(a, "GET", "/api/auth/me", nil, office...).Body.Bytes(), &identity); e != nil {
		t.Fatal(e)
	}
	if _, e := a.db.Exec("UPDATE crm_opportunities SET owner_id=? WHERE organization_id=? AND id=?", identity.Data.UserID, org, opp); e != nil {
		t.Fatal(e)
	}
	input := func(i int) map[string]any {
		return map[string]any{"action": "create", "opportunityId": opp, "itemName": "Example service", "quantity": 3, "unitPrice": 125, "idempotencyKey": fmt.Sprintf("quote-create-%08d", i)}
	}
	if w := request(a, "POST", path, input(99), front...); w.Code != 403 {
		t.Fatalf("front %d", w.Code)
	}
	if w := request(a, "POST", path, input(99), viewer...); w.Code != 403 {
		t.Fatalf("viewer %d", w.Code)
	}
	if w := request(a, "POST", path, input(99), other...); w.Code != 404 {
		t.Fatalf("foreign %d", w.Code)
	}
	var wg sync.WaitGroup
	type result struct {
		code, index int
		body        []byte
	}
	results := make(chan result, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			w := request(a, "POST", path, input(i), office...)
			results <- result{w.Code, i, w.Body.Bytes()}
		}(i)
	}
	wg.Wait()
	close(results)
	versions := map[int]bool{}
	quote := ""
	winner := 0
	for r := range results {
		if r.code != 200 {
			t.Errorf("create %d %s", r.code, r.body)
			continue
		}
		var v struct {
			Data struct {
				ID      string `json:"quoteId"`
				Version int    `json:"version"`
				Total   int    `json:"total"`
			} `json:"data"`
		}
		if e := json.Unmarshal(r.body, &v); e != nil {
			t.Fatal(e)
		}
		if versions[v.Data.Version] || v.Data.Total != 375 {
			t.Fatalf("duplicate version or wrong total %+v", v.Data)
		}
		versions[v.Data.Version] = true
		quote = v.Data.ID
		winner = r.index
	}
	if len(versions) != 12 {
		t.Fatalf("versions %d", len(versions))
	}
	if w := request(a, "POST", path, input(winner), office...); w.Code != 200 {
		t.Fatalf("retry %d", w.Code)
	}
	approve := func(i int) map[string]any {
		return map[string]any{"action": "approve", "quoteId": quote, "idempotencyKey": fmt.Sprintf("quote-approve-%08d", i)}
	}
	if w := request(a, "POST", path, approve(99), office...); w.Code != 403 {
		t.Fatalf("operator approval %d", w.Code)
	}
	if w := request(a, "POST", path, approve(99), other...); w.Code != 404 {
		t.Fatalf("foreign quote %d", w.Code)
	}
	if w := request(a, "POST", path, approve(0), admin...); w.Code != 200 {
		t.Fatalf("approve %d %s", w.Code, w.Body.String())
	}
	if w := request(a, "POST", path, approve(0), admin...); w.Code != 200 {
		t.Fatalf("approval replay %d", w.Code)
	}
	if w := request(a, "POST", path, approve(1), admin...); w.Code != 409 {
		t.Fatalf("double approval %d", w.Code)
	}
	var locked int
	var status string
	var amount int64
	if e := a.db.QueryRow("SELECT status,is_locked,total_amount FROM crm_quotes WHERE organization_id=? AND id=?", org, quote).Scan(&status, &locked, &amount); e != nil || status != "approved" || locked != 1 || amount != 375 {
		t.Fatalf("snapshot %s %d %d %v", status, locked, amount, e)
	}
}
