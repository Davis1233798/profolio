package main

import (
	"encoding/json"
	"sync"
	"testing"
)

func TestDiningOrdersModifiersRetriesAndSettlement(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	staff := loginSite(t, a, "front@suite.test", space, "dining")
	viewer := loginSite(t, a, "viewer@suite.test", space, "dining")
	other := loginSite(t, a, "admin@suite.test", token(), "dining")
	path := "/api/stations/dining/order"
	var session, drink, sold, group, option string
	var price, extra int64
	queries := []struct {
		q    string
		args []any
		dest []any
	}{{"SELECT id FROM dining_table_sessions WHERE organization_id=? AND status='active' LIMIT 1", []any{org}, []any{&session}}, {"SELECT id,price FROM dining_menu_items WHERE organization_id=? AND category IN ('飲品','Drinks') LIMIT 1", []any{org}, []any{&drink, &price}}, {"SELECT id FROM dining_menu_items WHERE organization_id=? AND is_sold_out=1 LIMIT 1", []any{org}, []any{&sold}}, {"SELECT g.id,o.id,o.additional_price FROM dining_modifier_groups g JOIN dining_modifier_options o ON o.group_id=g.id AND o.organization_id=g.organization_id WHERE g.organization_id=? AND g.is_required=1 LIMIT 1", []any{org}, []any{&group, &option, &extra}}}
	for _, q := range queries {
		if e := a.db.QueryRow(q.q, q.args...).Scan(q.dest...); e != nil {
			t.Fatal(e)
		}
	}
	line := map[string]any{"menuItemId": drink, "quantity": 2, "modifiers": []any{map[string]any{"groupId": group, "optionId": option}}}
	order := map[string]any{"orderType": "dine_in", "sessionId": session, "items": []any{line}, "idempotencyKey": "dining-order-0001"}
	if w := request(a, "POST", path, order, viewer...); w.Code != 403 {
		t.Fatalf("readonly %d", w.Code)
	}
	if w := request(a, "POST", path, order, other...); w.Code != 409 {
		t.Fatalf("foreign session %d", w.Code)
	}
	missing := map[string]any{"orderType": "dine_in", "sessionId": session, "items": []any{map[string]any{"menuItemId": drink, "quantity": 1}}, "idempotencyKey": "dining-order-0002"}
	if w := request(a, "POST", path, missing, staff...); w.Code != 400 {
		t.Fatalf("required modifier %d %s", w.Code, w.Body.String())
	}
	unavailable := map[string]any{"orderType": "takeout", "paymentMethod": "cash", "items": []any{map[string]any{"menuItemId": sold, "quantity": 1}}, "idempotencyKey": "dining-order-0003"}
	if w := request(a, "POST", path, unavailable, staff...); w.Code != 409 {
		t.Fatalf("sold out %d", w.Code)
	}
	var wg sync.WaitGroup
	results := make(chan []byte, 12)
	codes := make(chan int, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := request(a, "POST", path, order, staff...)
			codes <- w.Code
			results <- w.Body.Bytes()
		}()
	}
	wg.Wait()
	close(codes)
	close(results)
	for code := range codes {
		if code != 200 {
			t.Errorf("retry %d", code)
		}
	}
	var orderID string
	for b := range results {
		var v struct {
			Data struct {
				OrderID  string `json:"orderId"`
				Subtotal int64  `json:"subtotal"`
			} `json:"data"`
		}
		if e := json.Unmarshal(b, &v); e != nil {
			t.Fatal(e)
		}
		if orderID != "" && orderID != v.Data.OrderID {
			t.Fatal("retry created another order")
		}
		orderID = v.Data.OrderID
		if v.Data.Subtotal != (price+extra)*2 {
			t.Fatalf("subtotal %d", v.Data.Subtotal)
		}
	}
	var tickets int
	a.db.QueryRow("SELECT count(*) FROM dining_kitchen_tickets WHERE organization_id=? AND order_id=?", org, orderID).Scan(&tickets)
	if tickets != 1 {
		t.Fatalf("tickets %d", tickets)
	}
	takeout := map[string]any{"orderType": "takeout", "paymentMethod": "mock_card", "items": []any{line}, "idempotencyKey": "dining-order-0004"}
	w := request(a, "POST", path, takeout, staff...)
	if w.Code != 200 {
		t.Fatalf("takeout %d %s", w.Code, w.Body.String())
	}
	var result struct {
		Data struct {
			OrderID string `json:"orderId"`
			Takeout string `json:"takeoutNumber"`
		} `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &result)
	if result.Data.Takeout == "" {
		t.Fatal("missing takeout number")
	}
	var paid int
	a.db.QueryRow("SELECT count(*) FROM dining_bills b JOIN dining_payments p ON p.bill_id=b.id AND p.organization_id=b.organization_id WHERE b.organization_id=? AND b.order_id=? AND b.status='paid' AND p.payment_method='mock_card'", org, result.Data.OrderID).Scan(&paid)
	if paid != 1 {
		t.Fatalf("takeout payment %d", paid)
	}
	a.db.Exec("UPDATE dining_table_sessions SET status='closed' WHERE organization_id=? AND id=?", org, session)
	closed := map[string]any{"orderType": "dine_in", "sessionId": session, "items": []any{line}, "idempotencyKey": "dining-order-0005"}
	if w := request(a, "POST", path, closed, staff...); w.Code != 409 {
		t.Fatalf("closed table %d", w.Code)
	}
}

func TestDiningDrinkRequiresModifierInEnglishAndLegacyCategories(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	staff := loginSite(t, a, "front@suite.test", space, "dining")
	var drink string
	if err := a.db.QueryRow("SELECT id FROM dining_menu_items WHERE organization_id=? AND category='Drinks' LIMIT 1", org).Scan(&drink); err != nil {
		t.Fatal(err)
	}
	for _, category := range []string{"Drinks", "飲品"} {
		if _, err := a.db.Exec("UPDATE dining_menu_items SET category=? WHERE organization_id=? AND id=?", category, org, drink); err != nil {
			t.Fatal(err)
		}
		order := map[string]any{"orderType": "takeout", "paymentMethod": "cash", "items": []any{map[string]any{"menuItemId": drink, "quantity": 1}}, "idempotencyKey": "missing-modifier-" + category}
		if w := request(a, "POST", "/api/stations/dining/order", order, staff...); w.Code != 400 {
			t.Fatalf("%s: modifier requirement returned %d %s", category, w.Code, w.Body.String())
		}
	}
}
