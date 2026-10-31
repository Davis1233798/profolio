package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"testing"
)

func TestPOSBusinessShiftSaleRaceAndIsolation(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	admin := loginSite(t, a, "admin@suite.test", space, "pos")
	front := loginSite(t, a, "front@suite.test", space, "pos")
	viewer := loginSite(t, a, "viewer@suite.test", space, "pos")
	office := loginSite(t, a, "office@suite.test", space, "pos")
	var oldShift, register, item string
	var stock int
	var price int64
	if e := a.db.QueryRow("SELECT id,register_id FROM pos_shifts WHERE organization_id=? AND status='open'", org).Scan(&oldShift, &register); e != nil {
		t.Fatal(e)
	}
	if e := a.db.QueryRow("SELECT id,stock_quantity,price FROM pos_catalog_items WHERE organization_id=? AND stock_quantity>0 LIMIT 1", org).Scan(&item, &stock, &price); e != nil {
		t.Fatal(e)
	}
	path := "/api/stations/pos/business"
	closeOld := map[string]any{"action": "close", "shiftId": oldShift, "closingCash": 1000, "idempotencyKey": "close-old-00001"}
	if w := request(a, "POST", path, closeOld, office...); w.Code != 403 {
		t.Fatalf("front closes other shift %d", w.Code)
	}
	if w := request(a, "POST", path, closeOld, admin...); w.Code != 200 {
		t.Fatalf("admin close: %d %s", w.Code, w.Body.String())
	}
	open := map[string]any{"action": "open", "registerId": register, "openingCash": 1000, "idempotencyKey": "open-new-000001"}
	w := request(a, "POST", path, open, front...)
	if w.Code != 200 {
		t.Fatalf("open: %d %s", w.Code, w.Body.String())
	}
	var decoded struct {
		Data struct {
			ShiftID string `json:"shiftId"`
		} `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &decoded)
	shift := decoded.Data.ShiftID
	if shift == "" {
		t.Fatal("missing shift")
	}
	if w := request(a, "POST", path, open, front...); w.Code != 200 {
		t.Fatalf("open replay %d", w.Code)
	}
	if w := request(a, "POST", path, open, viewer...); w.Code != 403 {
		t.Fatalf("readonly open %d", w.Code)
	}
	other := loginSite(t, a, "admin@suite.test", token(), "pos")
	if w := request(a, "POST", path, open, other...); w.Code != 404 {
		t.Fatalf("cross-tenant register %d", w.Code)
	}
	var wg sync.WaitGroup
	type outcome struct {
		code, index int
		body        []byte
	}
	results := make(chan outcome, 32)
	input := func(i int) map[string]any {
		return map[string]any{"action": "checkout", "shiftId": shift, "itemId": item, "quantity": stock, "tender": price * int64(stock), "idempotencyKey": fmt.Sprintf("pos-race-%08d", i)}
	}
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			w := request(a, "POST", path, input(i), front...)
			results <- outcome{w.Code, i, w.Body.Bytes()}
		}(i)
	}
	wg.Wait()
	close(results)
	successes, conflicts := 0, 0
	winner := 0
	for x := range results {
		switch x.code {
		case 200:
			successes++
			winner = x.index
		case 409:
			conflicts++
		default:
			t.Errorf("unexpected %d: %s", x.code, x.body)
		}
	}
	if successes != 1 || conflicts != 31 {
		t.Fatalf("sale race success=%d conflicts=%d", successes, conflicts)
	}
	if w := request(a, "POST", path, input(winner), front...); w.Code != 200 {
		t.Fatalf("sale replay %d %s", w.Code, w.Body.String())
	}
	var remaining, sales, lines int
	a.db.QueryRow("SELECT stock_quantity FROM pos_catalog_items WHERE organization_id=? AND id=?", org, item).Scan(&remaining)
	a.db.QueryRow("SELECT count(*) FROM pos_sales WHERE organization_id=? AND shift_id=?", org, shift).Scan(&sales)
	a.db.QueryRow("SELECT count(*) FROM pos_sale_lines WHERE organization_id=?", org).Scan(&lines)
	if remaining != 0 || sales != 1 || lines != 1 {
		t.Fatalf("persisted stock=%d sales=%d lines=%d", remaining, sales, lines)
	}
	var line string
	if e := a.db.QueryRow("SELECT id FROM pos_sale_lines WHERE organization_id=? LIMIT 1", org).Scan(&line); e != nil {
		t.Fatal(e)
	}
	refund := map[string]any{"action": "refund", "saleLineId": line, "quantity": 1, "reason": "Demo return", "idempotencyKey": "refund-00000001"}
	if w := request(a, "POST", path, refund, front...); w.Code != 403 {
		t.Fatalf("front refund %d", w.Code)
	}
	if w := request(a, "POST", path, refund, admin...); w.Code != 200 {
		t.Fatalf("refund %d %s", w.Code, w.Body.String())
	}
	if w := request(a, "POST", path, refund, admin...); w.Code != 200 {
		t.Fatalf("refund replay %d", w.Code)
	}
	var afterRefund, refunds int
	a.db.QueryRow("SELECT stock_quantity FROM pos_catalog_items WHERE organization_id=? AND id=?", org, item).Scan(&afterRefund)
	a.db.QueryRow("SELECT count(*) FROM pos_refunds WHERE organization_id=?", org).Scan(&refunds)
	if afterRefund != 1 || refunds != 1 {
		t.Fatalf("refund stock=%d refunds=%d", afterRefund, refunds)
	}
	closeNew := map[string]any{"action": "close", "shiftId": shift, "closingCash": 1000 + price*int64(stock-1), "idempotencyKey": "close-new-00001"}
	w = request(a, "POST", path, closeNew, front...)
	if w.Code != 200 {
		t.Fatalf("close %d %s", w.Code, w.Body.String())
	}
	var closeResult struct {
		Data struct {
			ExpectedCash int64 `json:"expectedCash"`
			Discrepancy  int64 `json:"discrepancy"`
		} `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &closeResult)
	if closeResult.Data.ExpectedCash != 1000+price*int64(stock-1) || closeResult.Data.Discrepancy != 0 {
		t.Fatalf("cash close %#v", closeResult)
	}
}
