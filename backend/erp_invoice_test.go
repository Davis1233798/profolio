package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"testing"
)

func TestERPInvoiceSourceAndConcurrency(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	office := loginSite(t, a, "office@suite.test", space, "erp")
	front := loginSite(t, a, "front@suite.test", space, "erp")
	other := loginSite(t, a, "admin@suite.test", token(), "erp")
	var po, so string
	a.db.QueryRow("SELECT id FROM erp_purchase_orders WHERE organization_id=? LIMIT 1", org).Scan(&po)
	a.db.QueryRow("SELECT id FROM erp_sales_orders WHERE organization_id=? LIMIT 1", org).Scan(&so)
	path := "/api/stations/erp/finance"
	invoice := func(i int) map[string]any {
		return map[string]any{"action": "invoice", "invoiceKind": "payable", "orderId": po, "dueDate": "2035-01-15", "idempotencyKey": fmt.Sprintf("invoice-create-%08d", i)}
	}
	if w := request(a, "POST", path, invoice(99), front...); w.Code != 403 {
		t.Fatalf("front %d", w.Code)
	}
	if w := request(a, "POST", path, invoice(99), other...); w.Code != 404 {
		t.Fatalf("foreign %d", w.Code)
	}
	incomplete := map[string]any{"action": "invoice", "invoiceKind": "receivable", "orderId": so, "idempotencyKey": "invoice-incomplete-01"}
	if w := request(a, "POST", path, incomplete, office...); w.Code != 409 {
		t.Fatalf("incomplete shipment %d", w.Code)
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
			w := request(a, "POST", path, invoice(i), office...)
			results <- result{w.Code, i, w.Body.Bytes()}
		}(i)
	}
	wg.Wait()
	close(results)
	ok, conflicts := 0, 0
	var winner result
	for r := range results {
		if r.code == 200 {
			ok++
			winner = r
		} else if r.code == 409 {
			conflicts++
		} else {
			t.Errorf("invoice %d %s", r.code, r.body)
		}
	}
	if ok != 1 || conflicts != 11 {
		t.Fatalf("success %d conflict %d", ok, conflicts)
	}
	if w := request(a, "POST", path, invoice(winner.index), office...); w.Code != 200 {
		t.Fatalf("replay %d", w.Code)
	}
	var v struct {
		Data struct {
			ID    string `json:"invoiceId"`
			Total int64  `json:"totalAmount"`
		} `json:"data"`
	}
	json.Unmarshal(winner.body, &v)
	if v.Data.ID == "" || v.Data.Total != 1000 {
		t.Fatalf("invoice %+v", v.Data)
	}
	payment := map[string]any{"action": "payment", "invoiceId": v.Data.ID, "amount": 1000, "method": "cash", "idempotencyKey": "invoice-settle-0001"}
	if w := request(a, "POST", path, payment, office...); w.Code != 200 {
		t.Fatalf("payment %d %s", w.Code, w.Body.String())
	}
	var status string
	var paid int64
	a.db.QueryRow("SELECT status,paid_amount FROM erp_invoices WHERE organization_id=? AND id=?", org, v.Data.ID).Scan(&status, &paid)
	if status != "paid" || paid != 1000 {
		t.Fatalf("invoice state %s %d", status, paid)
	}
}
