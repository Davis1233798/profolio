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
	before := own["openPurchases"].(float64)
	if _, e := a.db.Exec("INSERT INTO erp_purchase_orders(id,organization_id,po_number,supplier_id,status,total_amount) VALUES('summary-po',?,'SUMMARY-PO','supplier','approved',100)", org); e != nil {
		t.Fatal(e)
	}
	if _, e := a.db.Exec("INSERT INTO erp_purchase_order_lines(id,organization_id,po_id,item_id,quantity,unit_price,received_quantity) VALUES('summary-line',?,'summary-po','item',10,10,4)", org); e != nil {
		t.Fatal(e)
	}
	if got := read("/api/stations/erp/data?view=back", admin...)["openPurchases"].(float64); got != before+1 {
		t.Fatalf("partially received count %v", got)
	}
	if _, e := a.db.Exec("UPDATE erp_purchase_order_lines SET received_quantity=10 WHERE id='summary-line'"); e != nil {
		t.Fatal(e)
	}
	if got := read("/api/stations/erp/data?view=back", admin...)["openPurchases"].(float64); got != before {
		t.Fatalf("fully received count %v", got)
	}
}
