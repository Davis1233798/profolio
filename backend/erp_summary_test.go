package main

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestERPSummaryTenantIsolation(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	admin := loginSite(t, a, "admin@suite.test", space, "erp")
	front := loginSite(t, a, "front@suite.test", space, "erp")
	other := loginSite(t, a, "admin@suite.test", token(), "erp")
	if _, e := a.db.Exec("INSERT INTO erp_invoices(id,organization_id,invoice_number,invoice_type,partner_type,partner_id,total_amount,paid_amount,status) VALUES('summary-test',?,'SUMMARY-TEST','receivable','customer','partner',1000,200,'partially_paid')", org); e != nil {
		t.Fatal(e)
	}
	read := func(path string, cookies ...*http.Cookie) map[string]any {
		w := request(a, "GET", path, nil, cookies...)
		var result struct {
			Data map[string]json.RawMessage `json:"data"`
		}
		if e := json.Unmarshal(w.Body.Bytes(), &result); e != nil || w.Code != 200 {
			t.Fatalf("response %d %v", w.Code, e)
		}
		var rows []map[string]any
		if raw := result.Data["erpSummary"]; len(raw) > 0 {
			if e := json.Unmarshal(raw, &rows); e != nil {
				t.Fatal(e)
			}
		}
		if len(rows) == 0 {
			return nil
		}
		return rows[0]
	}
	own := read("/api/stations/erp/data?view=back", admin...)
	foreign := read("/api/stations/erp/data?view=back", other...)
	if own["receivable"].(float64)-foreign["receivable"].(float64) != 800 {
		t.Fatalf("isolation own=%v other=%v", own, foreign)
	}
	if summary := read("/api/stations/erp/data?view=front", front...); summary != nil {
		t.Fatal("front received financial summary")
	}
}
