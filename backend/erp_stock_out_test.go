package main

import (
	"fmt"
	"sync"
	"testing"
)

func TestERPStockOutPreservesQuantityAndCost(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	office := loginSite(t, a, "office@suite.test", space, "erp")
	viewer := loginSite(t, a, "viewer@suite.test", space, "erp")
	front := loginSite(t, a, "front@suite.test", space, "erp")
	other := loginSite(t, a, "admin@suite.test", token(), "erp")
	path := "/api/stations/erp/stock-out"
	var order, line, item, warehouse string
	var ordered, shipped, balance, qty, cost int64
	if e := a.db.QueryRow("SELECT so_id,id,item_id,quantity,shipped_quantity FROM erp_sales_order_lines WHERE organization_id=? LIMIT 1", org).Scan(&order, &line, &item, &ordered, &shipped); e != nil {
		t.Fatal(e)
	}
	if e := a.db.QueryRow("SELECT warehouse_id,balance_after FROM erp_stock_ledger WHERE organization_id=? AND item_id=? ORDER BY rowid DESC LIMIT 1", org, item).Scan(&warehouse, &balance); e != nil {
		t.Fatal(e)
	}
	if e := a.db.QueryRow("SELECT total_quantity,total_cost FROM erp_item_costing WHERE organization_id=? AND item_id=?", org, item).Scan(&qty, &cost); e != nil {
		t.Fatal(e)
	}
	amount := ordered - shipped
	input := func(i int) map[string]any {
		return map[string]any{"action": "ship", "salesOrderId": order, "warehouseId": warehouse, "lines": []any{map[string]any{"lineId": line, "quantity": amount}}, "idempotencyKey": fmt.Sprintf("shipment-%08d", i)}
	}
	if w := request(a, "POST", path, input(99), front...); w.Code != 403 {
		t.Fatalf("front %d", w.Code)
	}
	if w := request(a, "POST", path, input(99), viewer...); w.Code != 403 {
		t.Fatalf("readonly %d", w.Code)
	}
	if w := request(a, "POST", path, input(99), other...); w.Code != 404 {
		t.Fatalf("foreign warehouse %d", w.Code)
	}
	bad := map[string]any{"action": "ship", "salesOrderId": order, "warehouseId": warehouse, "lines": []any{map[string]any{"lineId": line, "quantity": 1}, map[string]any{"lineId": "missing", "quantity": 1}}, "idempotencyKey": "shipment-rollback-01"}
	if w := request(a, "POST", path, bad, office...); w.Code != 404 {
		t.Fatalf("rollback %d", w.Code)
	}
	var after int64
	a.db.QueryRow("SELECT shipped_quantity FROM erp_sales_order_lines WHERE id=?", line).Scan(&after)
	if after != shipped {
		t.Fatal("partial shipment committed")
	}
	var wg sync.WaitGroup
	type outcome struct{ code, index int }
	results := make(chan outcome, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results <- outcome{request(a, "POST", path, input(i), office...).Code, i}
		}(i)
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
	if ok != 1 || conflicts != 11 {
		t.Fatalf("success %d conflicts %d", ok, conflicts)
	}
	if w := request(a, "POST", path, input(winner), office...); w.Code != 200 {
		t.Fatalf("retry %d", w.Code)
	}
	var remaining, newQty, newCost int64
	var status string
	a.db.QueryRow("SELECT balance_after FROM erp_stock_ledger WHERE organization_id=? AND item_id=? AND warehouse_id=? ORDER BY rowid DESC LIMIT 1", org, item, warehouse).Scan(&remaining)
	a.db.QueryRow("SELECT total_quantity,total_cost FROM erp_item_costing WHERE organization_id=? AND item_id=?", org, item).Scan(&newQty, &newCost)
	a.db.QueryRow("SELECT status FROM erp_sales_orders WHERE organization_id=? AND id=?", org, order).Scan(&status)
	removed := (cost/qty)*amount + ((cost%qty)*amount+qty/2)/qty
	if remaining != balance-amount || newQty != qty-amount || newCost != cost-removed || status != "shipped" {
		t.Fatalf("stock/cost mismatch %d %d %d %s", remaining, newQty, newCost, status)
	}
	returnAll := map[string]any{"action": "return", "itemId": item, "warehouseId": warehouse, "quantity": remaining, "reference": "DEMO-RETURN", "reason": "Return to supplier", "idempotencyKey": "purchase-return-0001"}
	if w := request(a, "POST", path, returnAll, office...); w.Code != 200 {
		t.Fatalf("return %d %s", w.Code, w.Body.String())
	}
	a.db.QueryRow("SELECT total_quantity,total_cost FROM erp_item_costing WHERE organization_id=? AND item_id=?", org, item).Scan(&newQty, &newCost)
	if newQty != 0 || newCost != 0 {
		t.Fatalf("cost remainder %d %d", newQty, newCost)
	}
}
