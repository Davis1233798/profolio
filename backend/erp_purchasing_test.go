package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"testing"
)

func TestERPPurchasingReceiptUnderContention(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	admin := loginSite(t, a, "admin@suite.test", space, "erp")
	office := loginSite(t, a, "office@suite.test", space, "erp")
	front := loginSite(t, a, "front@suite.test", space, "erp")
	viewer := loginSite(t, a, "viewer@suite.test", space, "erp")
	other := loginSite(t, a, "admin@suite.test", token(), "erp")
	path := "/api/stations/erp/purchasing"
	var item, warehouse, supplier string
	var initialBalance, initialQty, initialCost int64
	if e := a.db.QueryRow("SELECT item_id,warehouse_id,balance_after FROM erp_stock_ledger WHERE organization_id=? ORDER BY rowid DESC LIMIT 1", org).Scan(&item, &warehouse, &initialBalance); e != nil {
		t.Fatal(e)
	}
	if e := a.db.QueryRow("SELECT total_quantity,total_cost FROM erp_item_costing WHERE organization_id=? AND item_id=?", org, item).Scan(&initialQty, &initialCost); e != nil {
		t.Fatal(e)
	}
	if e := a.db.QueryRow("SELECT id FROM erp_suppliers WHERE organization_id=? LIMIT 1", org).Scan(&supplier); e != nil {
		t.Fatal(e)
	}
	create := map[string]any{"supplierId": supplier, "lines": []any{map[string]any{"itemId": item, "quantity": 10, "unitPrice": 100}}, "idempotencyKey": "purchase-create-0001"}
	if w := request(a, "POST", "/api/stations/erp/purchase-create", create, front...); w.Code != 403 {
		t.Fatalf("front create %d", w.Code)
	}
	if w := request(a, "POST", "/api/stations/erp/purchase-create", create, other...); w.Code != 404 {
		t.Fatalf("foreign supplier %d", w.Code)
	}
	w := request(a, "POST", "/api/stations/erp/purchase-create", create, office...)
	if w.Code != 200 {
		t.Fatalf("create %d %s", w.Code, w.Body.String())
	}
	var created struct {
		Data struct {
			POID  string `json:"poId"`
			Total int64  `json:"total"`
		} `json:"data"`
	}
	if e := json.Unmarshal(w.Body.Bytes(), &created); e != nil || created.Data.POID == "" || created.Data.Total != 1000 {
		t.Fatalf("create result %+v %v", created, e)
	}
	if w := request(a, "POST", "/api/stations/erp/purchase-create", create, office...); w.Code != 200 {
		t.Fatalf("create replay %d", w.Code)
	}
	po := created.Data.POID
	var line string
	if e := a.db.QueryRow("SELECT id FROM erp_purchase_order_lines WHERE organization_id=? AND po_id=?", org, po).Scan(&line); e != nil {
		t.Fatal(e)
	}
	approve := map[string]any{"action": "approve", "poId": po, "idempotencyKey": "purchase-approve-01"}
	if w := request(a, "POST", path, approve, office...); w.Code != 403 {
		t.Fatalf("operator approval %d", w.Code)
	}
	if w := request(a, "POST", path, approve, other...); w.Code != 404 {
		t.Fatalf("foreign PO %d", w.Code)
	}
	if w := request(a, "POST", path, approve, admin...); w.Code != 200 {
		t.Fatalf("approve %d %s", w.Code, w.Body.String())
	}
	input := func(i int) map[string]any {
		return map[string]any{"action": "receive", "poId": po, "warehouseId": warehouse, "lines": []any{map[string]any{"lineId": line, "quantity": 10}}, "idempotencyKey": fmt.Sprintf("purchase-receive-%08d", i)}
	}
	if w := request(a, "POST", path, input(99), viewer...); w.Code != 403 {
		t.Fatalf("readonly %d", w.Code)
	}
	if w := request(a, "POST", path, input(99), front...); w.Code != 403 {
		t.Fatalf("front %d", w.Code)
	}
	invalid := map[string]any{"action": "receive", "poId": po, "warehouseId": warehouse, "lines": []any{map[string]any{"lineId": line, "quantity": 1}, map[string]any{"lineId": "missing", "quantity": 1}}, "idempotencyKey": "purchase-rollback-01"}
	if w := request(a, "POST", path, invalid, office...); w.Code != 404 {
		t.Fatalf("rollback %d %s", w.Code, w.Body.String())
	}
	var pre int
	a.db.QueryRow("SELECT received_quantity FROM erp_purchase_order_lines WHERE id=?", line).Scan(&pre)
	if pre != 0 {
		t.Fatal("partial receipt was committed")
	}
	var wg sync.WaitGroup
	type result struct{ code, index int }
	results := make(chan result, 16)
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func(i int) { defer wg.Done(); results <- result{request(a, "POST", path, input(i), office...).Code, i} }(i)
	}
	wg.Wait()
	close(results)
	ok, conflicts, winner := 0, 0, 0
	for r := range results {
		if r.code == 200 {
			ok++
			winner = r.index
		} else if r.code == 409 {
			conflicts++
		} else {
			t.Errorf("unexpected %d", r.code)
		}
	}
	if ok != 1 || conflicts != 15 {
		t.Fatalf("success %d conflicts %d", ok, conflicts)
	}
	if w := request(a, "POST", path, input(winner), office...); w.Code != 200 {
		t.Fatalf("retry %d", w.Code)
	}
	var received int64
	var balance, qty, cost, average int64
	var receipts int
	a.db.QueryRow("SELECT received_quantity FROM erp_purchase_order_lines WHERE id=?", line).Scan(&received)
	a.db.QueryRow("SELECT balance_after FROM erp_stock_ledger WHERE organization_id=? AND item_id=? AND warehouse_id=? ORDER BY rowid DESC LIMIT 1", org, item, warehouse).Scan(&balance)
	a.db.QueryRow("SELECT total_quantity,total_cost,moving_average_cost FROM erp_item_costing WHERE organization_id=? AND item_id=?", org, item).Scan(&qty, &cost, &average)
	a.db.QueryRow("SELECT count(*) FROM erp_receipts WHERE organization_id=? AND po_id=?", org, po).Scan(&receipts)
	if received != 10 || balance != initialBalance+10 || qty != initialQty+10 || cost != initialCost+1000 || average != (cost+qty/2)/qty || receipts != 1 {
		t.Fatalf("incorrect receipt %d %d %d %d %d %d", received, balance, qty, cost, average, receipts)
	}
}
