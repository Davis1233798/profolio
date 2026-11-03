package main

import (
	"fmt"
	"sync"
	"testing"
)

func TestERPStockCountConcurrency(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	admin := loginSite(t, a, "admin@suite.test", space, "erp")
	office := loginSite(t, a, "office@suite.test", space, "erp")
	other := loginSite(t, a, "admin@suite.test", token(), "erp")
	var item, warehouse, version string
	var balance, qty, cost int64
	if e := a.db.QueryRow("SELECT item_id,warehouse_id,balance_after,id FROM erp_stock_ledger WHERE organization_id=? AND balance_after>1 ORDER BY rowid DESC LIMIT 1", org).Scan(&item, &warehouse, &balance, &version); e != nil {
		t.Fatal(e)
	}
	if e := a.db.QueryRow("SELECT total_quantity,total_cost FROM erp_item_costing WHERE organization_id=? AND item_id=?", org, item).Scan(&qty, &cost); e != nil {
		t.Fatal(e)
	}
	input := func(i int) map[string]any {
		return map[string]any{"itemId": item, "warehouseId": warehouse, "expectedQuantity": balance, "expectedVersion": version, "countedQuantity": balance - 1, "reason": "Count discrepancy", "idempotencyKey": fmt.Sprintf("count-test-%08d", i)}
	}
	path := "/api/stations/erp/stock-count"
	if w := request(a, "POST", path, input(99), office...); w.Code != 403 {
		t.Fatalf("office %d", w.Code)
	}
	if w := request(a, "POST", path, input(99), other...); w.Code != 404 {
		t.Fatalf("foreign %d", w.Code)
	}
	// A balance returning to the same quantity still invalidates the original snapshot.
	_, err := a.db.Exec("INSERT INTO erp_stock_ledger(id,organization_id,item_id,warehouse_id,change_type,quantity_change,balance_after,unit_cost,total_value,reference_doc) VALUES('aba-test',?,?,?,'adjustment',0,?,0,0,'test')", org, item, warehouse, balance)
	if err != nil {
		t.Fatal(err)
	}
	if w := request(a, "POST", path, input(98), admin...); w.Code != 409 {
		t.Fatalf("stale version %d", w.Code)
	}
	version = "aba-test"
	var wg sync.WaitGroup
	results := make(chan struct{ code, index int }, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results <- struct{ code, index int }{request(a, "POST", path, input(i), admin...).Code, i}
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
			t.Errorf("count %d", r.code)
		}
	}
	if success != 1 || conflicts != 11 {
		t.Fatalf("success %d conflicts %d", success, conflicts)
	}
	if w := request(a, "POST", path, input(winner), admin...); w.Code != 200 {
		t.Fatalf("retry %d", w.Code)
	}
	var newBalance, newQty, newCost int64
	var count int
	a.db.QueryRow("SELECT balance_after FROM erp_stock_ledger WHERE organization_id=? AND item_id=? AND warehouse_id=? ORDER BY rowid DESC LIMIT 1", org, item, warehouse).Scan(&newBalance)
	a.db.QueryRow("SELECT total_quantity,total_cost FROM erp_item_costing WHERE organization_id=? AND item_id=?", org, item).Scan(&newQty, &newCost)
	a.db.QueryRow("SELECT count(*) FROM erp_stock_ledger WHERE organization_id=? AND change_type='adjustment'", org).Scan(&count)
	expectedCost := cost - ((cost / qty) + ((cost%qty)+qty/2)/qty)
	if newBalance != balance-1 || newQty != qty-1 || newCost != expectedCost || count != 2 {
		t.Fatalf("state balance=%d qty=%d cost=%d adjustments=%d", newBalance, newQty, newCost, count)
	}
}
