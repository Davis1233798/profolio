package main

import (
	"encoding/json"
	"testing"
)

func TestShopCouponAllocationAndRefund(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	buyer := loginSite(t, a, "front@suite.test", space, "shop")
	admin := loginSite(t, a, "admin@suite.test", space, "shop")
	path := "/api/stations/shop/cart-checkout"
	var first, second string
	a.db.QueryRow("SELECT id FROM shop_variants WHERE organization_id=? AND stock_quantity=1", org).Scan(&first)
	a.db.QueryRow("SELECT id FROM shop_variants WHERE organization_id=? AND stock_quantity>1 LIMIT 1", org).Scan(&second)
	input := map[string]any{"lines": []any{map[string]any{"variantId": first, "quantity": 1}, map[string]any{"variantId": second, "quantity": 2}}, "couponCode": "SAVE10", "idempotencyKey": "coupon-cart-0001"}
	w := request(a, "POST", path, input, buyer...)
	if w.Code != 200 {
		t.Fatalf("checkout %d %s", w.Code, w.Body.String())
	}
	var v struct {
		Data struct {
			OrderID string `json:"orderId"`
			Total   int64  `json:"totalAmount"`
		} `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &v)
	if v.Data.Total != 330 {
		t.Fatalf("total %d", v.Data.Total)
	}
	var lineTotal, discount int64
	a.db.QueryRow("SELECT discount_amount FROM shop_orders WHERE organization_id=? AND id=?", org, v.Data.OrderID).Scan(&discount)
	a.db.QueryRow("SELECT SUM(line_total) FROM shop_order_items WHERE organization_id=? AND order_id=?", org, v.Data.OrderID).Scan(&lineTotal)
	if discount != 30 || lineTotal != 270 {
		t.Fatalf("discount %d lines %d", discount, lineTotal)
	}
	pay := map[string]any{"action": "pay", "orderId": v.Data.OrderID, "idempotencyKey": "coupon-pay-0001"}
	if w := request(a, "POST", "/api/stations/shop/business", pay, buyer...); w.Code != 200 {
		t.Fatalf("pay %d", w.Code)
	}
	ship := map[string]any{"action": "ship", "orderId": v.Data.OrderID, "tracking": "DEMO", "idempotencyKey": "coupon-ship-0001"}
	if w := request(a, "POST", "/api/stations/shop/business", ship, admin...); w.Code != 200 {
		t.Fatalf("ship %d", w.Code)
	}
	rows, e := a.db.Query("SELECT id,quantity FROM shop_order_items WHERE organization_id=? AND order_id=?", org, v.Data.OrderID)
	if e != nil {
		t.Fatal(e)
	}
	type line struct {
		id  string
		qty int
	}
	var lines []line
	for rows.Next() {
		var l line
		rows.Scan(&l.id, &l.qty)
		lines = append(lines, l)
	}
	rows.Close()
	for i, l := range lines {
		refund := map[string]any{"action": "refund", "orderId": v.Data.OrderID, "itemId": l.id, "quantity": l.qty, "reason": "demo", "idempotencyKey": []string{"coupon-refund-01", "coupon-refund-02"}[i]}
		if w := request(a, "POST", "/api/stations/shop/after-sales", refund, admin...); w.Code != 200 {
			t.Fatalf("refund %d %s", w.Code, w.Body.String())
		}
	}
	var refunded int64
	a.db.QueryRow("SELECT sum(refund_amount) FROM shop_returns WHERE organization_id=? AND order_id=?", org, v.Data.OrderID).Scan(&refunded)
	if refunded != 270 {
		t.Fatalf("refund amount %d", refunded)
	}
	invalid := map[string]any{"lines": input["lines"], "couponCode": "EXPIRED50", "idempotencyKey": "coupon-expired-01"}
	if w := request(a, "POST", path, invalid, buyer...); w.Code != 409 {
		t.Fatalf("expired coupon %d", w.Code)
	}
}
