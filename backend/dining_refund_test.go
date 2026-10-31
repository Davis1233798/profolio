package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"testing"
)

func TestDiningTakeoutRefundIsAtomic(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	admin := loginSite(t, a, "admin@suite.test", space, "dining")
	staff := loginSite(t, a, "front@suite.test", space, "dining")
	other := loginSite(t, a, "admin@suite.test", token(), "dining")
	var menu string
	if e := a.db.QueryRow("SELECT id FROM dining_menu_items WHERE organization_id=? AND is_sold_out=0 AND category!='飲品' LIMIT 1", org).Scan(&menu); e != nil {
		t.Fatal(e)
	}
	order := map[string]any{"orderType": "takeout", "paymentMethod": "mock_card", "items": []any{map[string]any{"menuItemId": menu, "quantity": 2}}, "idempotencyKey": "refund-order-0001"}
	w := request(a, "POST", "/api/stations/dining/order", order, staff...)
	if w.Code != 200 {
		t.Fatalf("order %d %s", w.Code, w.Body.String())
	}
	var v struct {
		Data struct {
			OrderID string `json:"orderId"`
			Total   int64  `json:"total"`
		} `json:"data"`
	}
	if e := json.Unmarshal(w.Body.Bytes(), &v); e != nil {
		t.Fatal(e)
	}
	path := "/api/stations/dining/service"
	input := func(i int) map[string]any {
		return map[string]any{"action": "refund", "orderId": v.Data.OrderID, "reason": "Guest request", "idempotencyKey": fmt.Sprintf("takeout-refund-%08d", i)}
	}
	if w := request(a, "POST", path, input(99), staff...); w.Code != 403 {
		t.Fatalf("staff refund %d", w.Code)
	}
	if w := request(a, "POST", path, input(99), other...); w.Code != 404 {
		t.Fatalf("foreign order %d", w.Code)
	}
	var wg sync.WaitGroup
	type result struct{ code, index int }
	results := make(chan result, 16)
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func(i int) { defer wg.Done(); results <- result{request(a, "POST", path, input(i), admin...).Code, i} }(i)
	}
	wg.Wait()
	close(results)
	ok, conflict, winner := 0, 0, 0
	for r := range results {
		if r.code == 200 {
			ok++
			winner = r.index
		} else if r.code == 409 {
			conflict++
		} else {
			t.Errorf("unexpected refund %d", r.code)
		}
	}
	if ok != 1 || conflict != 15 {
		t.Fatalf("refund success=%d conflict=%d", ok, conflict)
	}
	if w := request(a, "POST", path, input(winner), admin...); w.Code != 200 {
		t.Fatalf("replay %d", w.Code)
	}
	var balance int64
	var payments int
	var billStatus, orderStatus, itemStatus, kitchenStatus string
	a.db.QueryRow("SELECT b.status,COALESCE(SUM(p.amount),0),COUNT(p.id) FROM dining_bills b JOIN dining_payments p ON p.bill_id=b.id AND p.organization_id=b.organization_id WHERE b.organization_id=? AND b.order_id=? GROUP BY b.id", org, v.Data.OrderID).Scan(&billStatus, &balance, &payments)
	a.db.QueryRow("SELECT status FROM dining_orders WHERE organization_id=? AND id=?", org, v.Data.OrderID).Scan(&orderStatus)
	a.db.QueryRow("SELECT status FROM dining_order_items WHERE organization_id=? AND order_id=?", org, v.Data.OrderID).Scan(&itemStatus)
	a.db.QueryRow("SELECT status FROM dining_kitchen_tickets WHERE organization_id=? AND order_id=?", org, v.Data.OrderID).Scan(&kitchenStatus)
	if billStatus != "refunded" || balance != 0 || payments != 2 || orderStatus != "cancelled" || itemStatus != "cancelled" || kitchenStatus != "served" {
		t.Fatalf("inconsistent refund %s %d %d %s %s %s", billStatus, balance, payments, orderStatus, itemStatus, kitchenStatus)
	}
}
