package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"testing"
)

func TestERPTransferConservesStockUnderContention(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	op := loginSite(t, a, "front@suite.test", space, "erp")
	viewer := loginSite(t, a, "viewer@suite.test", space, "erp")
	other := loginSite(t, a, "admin@suite.test", token(), "erp")
	var item, source, dest string
	var amount int
	if e := a.db.QueryRow("SELECT item_id,warehouse_id,balance_after FROM erp_stock_ledger WHERE organization_id=? ORDER BY rowid DESC LIMIT 1", org).Scan(&item, &source, &amount); e != nil {
		t.Fatal(e)
	}
	if e := a.db.QueryRow("SELECT id FROM erp_warehouses WHERE organization_id=? AND id!=? LIMIT 1", org, source).Scan(&dest); e != nil {
		t.Fatal(e)
	}
	input := func(i int) map[string]any {
		return map[string]any{"action": "transfer", "itemId": item, "fromWarehouseId": source, "toWarehouseId": dest, "quantity": amount, "idempotencyKey": fmt.Sprintf("erp-transfer-%08d", i)}
	}
	path := "/api/stations/erp/business"
	if w := request(a, "POST", path, input(99), viewer...); w.Code != 403 {
		t.Fatalf("readonly %d", w.Code)
	}
	if w := request(a, "POST", path, input(99), other...); w.Code != 404 {
		t.Fatalf("foreign item %d", w.Code)
	}
	var wg sync.WaitGroup
	type result struct {
		code, index int
		body        []byte
	}
	results := make(chan result, 16)
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			w := request(a, "POST", path, input(i), op...)
			results <- result{w.Code, i, w.Body.Bytes()}
		}(i)
	}
	wg.Wait()
	close(results)
	good, conflict, winner := 0, 0, 0
	for x := range results {
		switch x.code {
		case 200:
			good++
			winner = x.index
		case 409:
			conflict++
		default:
			t.Errorf("unexpected %d %s", x.code, x.body)
		}
	}
	if good != 1 || conflict != 15 {
		t.Fatalf("race good=%d conflicts=%d", good, conflict)
	}
	w := request(a, "POST", path, input(winner), op...)
	if w.Code != 200 {
		t.Fatalf("retry %d %s", w.Code, w.Body.String())
	}
	var resultData struct {
		Data struct {
			Source      int `json:"sourceBalance"`
			Destination int `json:"destinationBalance"`
		} `json:"data"`
	}
	if e := json.Unmarshal(w.Body.Bytes(), &resultData); e != nil {
		t.Fatal(e)
	}
	if resultData.Data.Source != 0 || resultData.Data.Destination != amount {
		t.Fatalf("balances %+v", resultData)
	}
	var out, in, audits int
	a.db.QueryRow("SELECT count(*) FROM erp_stock_ledger WHERE organization_id=? AND change_type='transfer_out'", org).Scan(&out)
	a.db.QueryRow("SELECT count(*) FROM erp_stock_ledger WHERE organization_id=? AND change_type='transfer_in'", org).Scan(&in)
	a.db.QueryRow("SELECT count(*) FROM audit_events WHERE organization_id=? AND action='erp.transfer'", org).Scan(&audits)
	if out != 1 || in != 1 || audits != 1 {
		t.Fatalf("records %d %d audits %d", out, in, audits)
	}
	changed := input(winner)
	changed["quantity"] = 1
	if w := request(a, "POST", path, changed, op...); w.Code != 409 {
		t.Fatalf("changed retry %d", w.Code)
	}
}
