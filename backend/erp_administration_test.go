package main

import (
	"fmt"
	"sync"
	"testing"
)

func TestERPAdministration(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	admin := loginSite(t, a, "admin@suite.test", space, "erp")
	office := loginSite(t, a, "office@suite.test", space, "erp")
	viewer := loginSite(t, a, "viewer@suite.test", space, "erp")
	other := loginSite(t, a, "admin@suite.test", token(), "erp")
	path := "/api/stations/erp/administration"
	partner := map[string]any{"action": "partner", "kind": "supplier", "code": "SUP-NEW", "name": "Example supplier", "email": "contact@example.test", "idempotencyKey": "partner-test-0001"}
	if w := request(a, "POST", path, partner, viewer...); w.Code != 403 {
		t.Fatalf("viewer %d", w.Code)
	}
	if w := request(a, "POST", path, partner, office...); w.Code != 200 {
		t.Fatalf("create %d %s", w.Code, w.Body.String())
	}
	if w := request(a, "POST", path, partner, office...); w.Code != 200 {
		t.Fatalf("replay %d", w.Code)
	}
	dup := map[string]any{"action": "partner", "kind": "supplier", "code": "sup-new", "name": "Duplicate", "idempotencyKey": "partner-test-0002"}
	if w := request(a, "POST", path, dup, office...); w.Code != 409 {
		t.Fatalf("duplicate %d", w.Code)
	}
	if w := request(a, "POST", path, dup, other...); w.Code != 200 {
		t.Fatalf("other tenant %d", w.Code)
	}
	var period string
	if e := a.db.QueryRow("SELECT id FROM erp_fiscal_periods WHERE organization_id=? AND is_closed=0 LIMIT 1", org).Scan(&period); e != nil {
		t.Fatal(e)
	}
	closeRequest := func(i int) map[string]any {
		return map[string]any{"action": "closePeriod", "periodId": period, "idempotencyKey": fmt.Sprintf("close-period-%08d", i)}
	}
	if w := request(a, "POST", path, closeRequest(99), office...); w.Code != 403 {
		t.Fatalf("office close %d", w.Code)
	}
	if w := request(a, "POST", path, closeRequest(99), other...); w.Code != 404 {
		t.Fatalf("foreign period %d", w.Code)
	}
	var wg sync.WaitGroup
	results := make(chan struct{ code, index int }, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results <- struct{ code, index int }{request(a, "POST", path, closeRequest(i), admin...).Code, i}
		}(i)
	}
	wg.Wait()
	close(results)
	success, conflicts, winner := 0, 0, 0
	for r := range results {
		if r.code == 200 {
			success++
			winner = r.index
		} else if r.code == 409 {
			conflicts++
		} else {
			t.Errorf("close %d", r.code)
		}
	}
	if success != 1 || conflicts != 11 {
		t.Fatalf("close successes %d conflicts %d", success, conflicts)
	}
	if w := request(a, "POST", path, closeRequest(winner), admin...); w.Code != 200 {
		t.Fatalf("close replay %d", w.Code)
	}
	var date string
	if e := a.db.QueryRow("SELECT start_date FROM erp_fiscal_periods WHERE id=? AND organization_id=?", period, org).Scan(&date); e != nil {
		t.Fatal(e)
	}
	journal := map[string]any{"action": "journal", "entryDate": date, "description": "Closed period", "lines": []any{map[string]any{"accountCode": "1", "accountName": "Cash", "debitAmount": 1}, map[string]any{"accountCode": "2", "accountName": "Equity", "creditAmount": 1}}, "idempotencyKey": "closed-period-journal"}
	if w := request(a, "POST", "/api/stations/erp/finance", journal, office...); w.Code != 409 {
		t.Fatalf("closed journal %d %s", w.Code, w.Body.String())
	}
}

func TestERPAdministrationRejectsUnbalancedClose(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	admin := loginSite(t, a, "admin@suite.test", space, "erp")
	var period string
	if e := a.db.QueryRow("SELECT id FROM erp_fiscal_periods WHERE organization_id=? AND is_closed=0 LIMIT 1", org).Scan(&period); e != nil {
		t.Fatal(e)
	}
	_, e := a.db.Exec("INSERT INTO erp_journal_entries(id,organization_id,entry_number,entry_date,description,status) VALUES('test-unbalanced',?,'TEST-U','2026-10-01','test','posted')", org)
	if e != nil {
		t.Fatal(e)
	}
	_, e = a.db.Exec("INSERT INTO erp_journal_lines(id,organization_id,journal_id,account_code,account_name,debit_amount,credit_amount) VALUES('test-unbalanced-line',?,'test-unbalanced','1','Cash',1,0)", org)
	if e != nil {
		t.Fatal(e)
	}
	w := request(a, "POST", "/api/stations/erp/administration", map[string]any{"action": "closePeriod", "periodId": period, "idempotencyKey": "unbalanced-close-test"}, admin...)
	if w.Code != 409 {
		t.Fatalf("unbalanced close %d %s", w.Code, w.Body.String())
	}
}
