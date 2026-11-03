package main

import (
	"sync"
	"testing"
)

func TestKitchenTransitionConcurrencyAndTenantIsolation(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	cook := loginSite(t, a, "front@suite.test", space, "dining")
	viewer := loginSite(t, a, "viewer@suite.test", space, "dining")
	other := loginSite(t, a, "admin@suite.test", token(), "dining")
	var ticket, item string
	if e := a.db.QueryRow("SELECT id,order_item_id FROM dining_kitchen_tickets WHERE organization_id=? AND status='received' LIMIT 1", org).Scan(&ticket, &item); e != nil {
		t.Fatal(e)
	}
	path := "/api/stations/dining/business"
	input := map[string]any{"ticketId": ticket, "expected": "received", "next": "cooking"}
	if w := request(a, "POST", path, map[string]any{"ticketId": ticket, "expected": "received", "next": "served"}, cook...); w.Code != 400 {
		t.Fatalf("skipped kitchen state %d", w.Code)
	}
	if w := request(a, "POST", path, input, viewer...); w.Code != 403 {
		t.Fatalf("readonly %d", w.Code)
	}
	if w := request(a, "POST", path, input, other...); w.Code != 404 {
		t.Fatalf("foreign %d", w.Code)
	}
	var wg sync.WaitGroup
	results := make(chan int, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); results <- request(a, "POST", path, input, cook...).Code }()
	}
	wg.Wait()
	close(results)
	ok, conflict := 0, 0
	for code := range results {
		if code == 200 {
			ok++
		} else if code == 409 {
			conflict++
		} else {
			t.Errorf("unexpected %d", code)
		}
	}
	if ok != 1 || conflict != 11 {
		t.Fatalf("success %d conflicts %d", ok, conflict)
	}
	var state string
	if e := a.db.QueryRow("SELECT status FROM dining_order_items WHERE id=? AND organization_id=?", item, org).Scan(&state); e != nil || state != "preparing" {
		t.Fatalf("item %s %v", state, e)
	}
	for _, step := range [][2]string{{"cooking", "done"}, {"done", "served"}} {
		w := request(a, "POST", path, map[string]any{"ticketId": ticket, "expected": step[0], "next": step[1]}, cook...)
		if w.Code != 200 {
			t.Fatalf("step %v: %d %s", step, w.Code, w.Body.String())
		}
	}
}
