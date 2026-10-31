package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
)

func TestPOSCartClaimAndMultiItemCheckout(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	admin := loginSite(t, a, "admin@suite.test", space, "pos")
	staff := loginSite(t, a, "front@suite.test", space, "pos")
	viewer := loginSite(t, a, "viewer@suite.test", space, "pos")
	other := loginSite(t, a, "admin@suite.test", token(), "pos")
	path := "/api/stations/pos/cart"
	var shift string
	if e := a.db.QueryRow("SELECT id FROM pos_shifts WHERE organization_id=? AND status='open' LIMIT 1", org).Scan(&shift); e != nil {
		t.Fatal(e)
	}
	rows, e := a.db.Query("SELECT id,price,stock_quantity FROM pos_catalog_items WHERE organization_id=? AND is_active=1 AND stock_quantity>=2 ORDER BY id LIMIT 2", org)
	if e != nil {
		t.Fatal(e)
	}
	type item struct {
		id           string
		price, stock int64
	}
	var products []item
	for rows.Next() {
		var v item
		if e := rows.Scan(&v.id, &v.price, &v.stock); e != nil {
			t.Fatal(e)
		}
		products = append(products, v)
	}
	rows.Close()
	if len(products) != 2 {
		t.Fatal("need two seeded products")
	}
	lines := []any{map[string]any{"itemId": products[0].id, "quantity": 1}, map[string]any{"itemId": products[1].id, "quantity": 2}}
	hold := map[string]any{"action": "hold", "shiftId": shift, "cartName": "Example cart", "lines": lines, "idempotencyKey": "pos-hold-000001"}
	if w := request(a, "POST", path, hold, viewer...); w.Code != 403 {
		t.Fatalf("readonly %d", w.Code)
	}
	if w := request(a, "POST", path, hold, other...); w.Code != 404 {
		t.Fatalf("foreign shift %d", w.Code)
	}
	w := request(a, "POST", path, hold, staff...)
	if w.Code != 200 {
		t.Fatalf("hold %d %s", w.Code, w.Body.String())
	}
	var v struct {
		Data struct {
			ID string `json:"cartId"`
		} `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &v)
	cart := v.Data.ID
	if w := request(a, "POST", path, hold, staff...); w.Code != 200 {
		t.Fatalf("hold replay %d", w.Code)
	}
	claim := func(i int) map[string]any {
		return map[string]any{"action": "claim", "shiftId": shift, "cartId": cart, "idempotencyKey": fmt.Sprintf("cart-claim-%08d", i)}
	}
	type outcome struct {
		code, index int
		cookies     []*http.Cookie
	}
	results := make(chan outcome, 12)
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			who := staff
			if i%2 == 1 {
				who = admin
			}
			results <- outcome{request(a, "POST", path, claim(i), who...).Code, i, who}
		}(i)
	}
	wg.Wait()
	close(results)
	ok, conflict, winner := 0, 0, outcome{}
	for r := range results {
		if r.code == 200 {
			ok++
			winner = r
		} else if r.code == 409 {
			conflict++
		} else {
			t.Errorf("claim %d", r.code)
		}
	}
	if ok != 1 || conflict != 11 {
		t.Fatalf("claim %d %d", ok, conflict)
	}
	if w := request(a, "POST", path, claim(winner.index), winner.cookies...); w.Code != 200 {
		t.Fatalf("claim replay %d", w.Code)
	}
	loser := staff
	if winner.index%2 == 0 {
		loser = admin
	}
	snapshot := request(a, "GET", "/api/stations/pos/data?view=front", nil, loser...)
	if snapshot.Code != 200 || strings.Contains(snapshot.Body.String(), cart) {
		t.Fatal("claimed cart exposed to another user")
	}
	total := products[0].price + 2*products[1].price
	checkout := map[string]any{"action": "checkout", "shiftId": shift, "cartId": cart, "tender": total + 100, "idempotencyKey": "cart-checkout-0001"}
	if w := request(a, "POST", path, checkout, loser...); w.Code != 409 {
		t.Fatalf("foreign claim checkout %d", w.Code)
	}
	w = request(a, "POST", path, checkout, winner.cookies...)
	if w.Code != 200 {
		t.Fatalf("checkout %d %s", w.Code, w.Body.String())
	}
	var sale struct {
		Data struct {
			ID     string `json:"saleId"`
			Total  int64  `json:"totalAmount"`
			Change int64  `json:"changeAmount"`
		} `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &sale)
	if sale.Data.Total != total || sale.Data.Change != 100 {
		t.Fatalf("totals %+v", sale.Data)
	}
	if w := request(a, "POST", path, checkout, winner.cookies...); w.Code != 200 {
		t.Fatalf("checkout replay %d", w.Code)
	}
	var count int
	var state string
	a.db.QueryRow("SELECT count(*) FROM pos_sale_lines WHERE organization_id=? AND sale_id=?", org, sale.Data.ID).Scan(&count)
	a.db.QueryRow("SELECT status FROM pos_held_carts WHERE organization_id=? AND id=?", org, cart).Scan(&state)
	if count != 2 || state != "completed" {
		t.Fatalf("cart %s lines %d", state, count)
	}
	for i, p := range products {
		var stock int64
		a.db.QueryRow("SELECT stock_quantity FROM pos_catalog_items WHERE organization_id=? AND id=?", org, p.id).Scan(&stock)
		expected := p.stock - 1
		if i == 1 {
			expected = p.stock - 2
		}
		if stock != expected {
			t.Fatalf("stock %d expected %d", stock, expected)
		}
	}
	invalid := map[string]any{"action": "checkout", "shiftId": shift, "lines": []any{map[string]any{"itemId": products[0].id, "quantity": 1}, map[string]any{"itemId": products[1].id, "quantity": 1000}}, "tender": 1000000000, "idempotencyKey": "cart-rollback-0001"}
	if w := request(a, "POST", path, invalid, staff...); w.Code != 409 {
		t.Fatalf("insufficient stock %d", w.Code)
	}
	var after int64
	a.db.QueryRow("SELECT stock_quantity FROM pos_catalog_items WHERE organization_id=? AND id=?", org, products[0].id).Scan(&after)
	if after != products[0].stock-1 {
		t.Fatal("failed cart partially deducted inventory")
	}
}
