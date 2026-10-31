package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"testing"
)

func TestERPFinancePaymentAndBalancedJournal(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	office := loginSite(t, a, "office@suite.test", space, "erp")
	front := loginSite(t, a, "front@suite.test", space, "erp")
	viewer := loginSite(t, a, "viewer@suite.test", space, "erp")
	other := loginSite(t, a, "admin@suite.test", token(), "erp")
	path := "/api/stations/erp/finance"
	var invoice string
	var total, paid int64
	if e := a.db.QueryRow("SELECT id,total_amount,paid_amount FROM erp_invoices WHERE organization_id=? AND status='partially_paid' LIMIT 1", org).Scan(&invoice, &total, &paid); e != nil {
		t.Fatal(e)
	}
	input := func(i int) map[string]any {
		return map[string]any{"action": "payment", "invoiceId": invoice, "amount": total - paid, "method": "bank_transfer", "idempotencyKey": fmt.Sprintf("invoice-payment-%08d", i)}
	}
	if w := request(a, "POST", path, input(99), front...); w.Code != 403 {
		t.Fatalf("front %d", w.Code)
	}
	if w := request(a, "POST", path, input(99), viewer...); w.Code != 403 {
		t.Fatalf("readonly %d", w.Code)
	}
	if w := request(a, "POST", path, input(99), other...); w.Code != 404 {
		t.Fatalf("foreign invoice %d", w.Code)
	}
	var wg sync.WaitGroup
	type result struct{ code, index int }
	results := make(chan result, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) { defer wg.Done(); results <- result{request(a, "POST", path, input(i), office...).Code, i} }(i)
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
			t.Errorf("payment %d", r.code)
		}
	}
	if success != 1 || conflicts != 11 {
		t.Fatalf("success %d conflicts %d", success, conflicts)
	}
	if w := request(a, "POST", path, input(winner), office...); w.Code != 200 {
		t.Fatalf("replay %d", w.Code)
	}
	var newPaid int64
	var status string
	var count int
	a.db.QueryRow("SELECT paid_amount,status FROM erp_invoices WHERE organization_id=? AND id=?", org, invoice).Scan(&newPaid, &status)
	a.db.QueryRow("SELECT count(*) FROM erp_payments WHERE organization_id=? AND invoice_id=?", org, invoice).Scan(&count)
	if newPaid != total || status != "paid" || count != 1 {
		t.Fatalf("payment state %d %s %d", newPaid, status, count)
	}
	lines := []any{map[string]any{"accountCode": "1101", "accountName": "Cash", "debitAmount": 101, "creditAmount": 0}, map[string]any{"accountCode": "3101", "accountName": "Capital", "debitAmount": 0, "creditAmount": 101}}
	journal := map[string]any{"action": "journal", "entryDate": "2027-01-15", "description": "Example entry", "lines": lines, "idempotencyKey": "journal-test-0001"}
	unbalanced := map[string]any{"action": "journal", "entryDate": "2027-01-15", "description": "Bad", "lines": []any{map[string]any{"accountCode": "1", "accountName": "A", "debitAmount": 10}, map[string]any{"accountCode": "2", "accountName": "B", "creditAmount": 9}}, "idempotencyKey": "journal-test-0002"}
	if w := request(a, "POST", path, unbalanced, office...); w.Code != 400 {
		t.Fatalf("unbalanced %d", w.Code)
	}
	a.db.Exec("UPDATE erp_fiscal_periods SET is_closed=1 WHERE organization_id=?", org)
	closed := map[string]any{"action": "journal", "entryDate": "2026-10-15", "description": "Closed period", "lines": lines, "idempotencyKey": "journal-test-0003"}
	if w := request(a, "POST", path, closed, office...); w.Code != 409 {
		t.Fatalf("closed period %d", w.Code)
	}
	if w := request(a, "POST", path, journal, office...); w.Code != 200 {
		t.Fatalf("journal %d %s", w.Code, w.Body.String())
	}
	if w := request(a, "POST", path, journal, office...); w.Code != 200 {
		t.Fatalf("journal replay %d", w.Code)
	}
	response := request(a, "GET", "/api/stations/erp/data?view=back", nil, office...)
	var snapshot struct {
		Data struct {
			Trial []struct {
				Debit  int64 `json:"debitTotal"`
				Credit int64 `json:"creditTotal"`
			} `json:"trialBalance"`
		} `json:"data"`
	}
	if e := json.Unmarshal(response.Body.Bytes(), &snapshot); e != nil || response.Code != 200 {
		t.Fatalf("trial balance %d %v", response.Code, e)
	}
	var debit, credit int64
	for _, row := range snapshot.Data.Trial {
		debit += row.Debit
		credit += row.Credit
	}
	if debit != credit || debit < 101 {
		t.Fatalf("trial balance %d %d", debit, credit)
	}
}
