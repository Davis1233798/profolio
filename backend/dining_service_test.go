package main

import (
	"fmt"
	"sync"
	"testing"
)

func TestDiningServiceReservationAndVoids(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	staff := loginSite(t, a, "front@suite.test", space, "dining")
	admin := loginSite(t, a, "admin@suite.test", space, "dining")
	viewer := loginSite(t, a, "viewer@suite.test", space, "dining")
	other := loginSite(t, a, "admin@suite.test", token(), "dining")
	path := "/api/stations/dining/service"
	var table, ticket, item string
	if e := a.db.QueryRow("SELECT id FROM dining_tables WHERE organization_id=? AND capacity>=2 LIMIT 1", org).Scan(&table); e != nil {
		t.Fatal(e)
	}
	if e := a.db.QueryRow("SELECT k.id,i.id FROM dining_kitchen_tickets k JOIN dining_order_items i ON i.id=k.order_item_id AND i.organization_id=k.organization_id WHERE k.organization_id=? AND i.status='preparing' LIMIT 1", org).Scan(&ticket, &item); e != nil {
		t.Fatal(e)
	}
	input := func(i int) map[string]any {
		return map[string]any{"action": "reserve", "tableId": table, "name": "Example Guest", "phone": "DEMO-PHONE", "guests": 2, "reservationTime": "2035-10-01T10:00:00Z", "idempotencyKey": fmt.Sprintf("reserve-%08d", i)}
	}
	if w := request(a, "POST", path, input(99), viewer...); w.Code != 403 {
		t.Fatalf("readonly %d", w.Code)
	}
	if w := request(a, "POST", path, input(99), other...); w.Code != 404 {
		t.Fatalf("foreign table %d", w.Code)
	}
	var wg sync.WaitGroup
	type result struct{ code, index int }
	results := make(chan result, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) { defer wg.Done(); results <- result{request(a, "POST", path, input(i), staff...).Code, i} }(i)
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
			t.Errorf("reservation %d", r.code)
		}
	}
	if ok != 1 || conflicts != 11 {
		t.Fatalf("success %d conflicts %d", ok, conflicts)
	}
	if w := request(a, "POST", path, input(winner), staff...); w.Code != 200 {
		t.Fatalf("replay %d", w.Code)
	}
	adjacent := input(100)
	adjacent["reservationTime"] = "2035-10-01T11:30:00Z"
	if w := request(a, "POST", path, adjacent, staff...); w.Code != 200 {
		t.Fatalf("adjacent %d %s", w.Code, w.Body.String())
	}
	urge := map[string]any{"action": "urge", "ticketId": ticket, "idempotencyKey": "urge-ticket-0001"}
	if w := request(a, "POST", path, urge, staff...); w.Code != 200 {
		t.Fatalf("urge %d", w.Code)
	}
	cancel := map[string]any{"action": "cancel", "itemId": item, "reason": "Guest requested", "idempotencyKey": "cancel-item-0001"}
	if w := request(a, "POST", path, cancel, staff...); w.Code != 403 {
		t.Fatalf("manager required %d", w.Code)
	}
	if w := request(a, "POST", path, cancel, other...); w.Code != 404 {
		t.Fatalf("foreign item %d", w.Code)
	}
	if w := request(a, "POST", path, cancel, admin...); w.Code != 200 {
		t.Fatalf("manager cancel %d %s", w.Code, w.Body.String())
	}
	if w := request(a, "POST", path, cancel, admin...); w.Code != 200 {
		t.Fatalf("cancel replay %d", w.Code)
	}
	second := map[string]any{"action": "cancel", "itemId": item, "reason": "Guest requested", "idempotencyKey": "cancel-item-0002"}
	if w := request(a, "POST", path, second, admin...); w.Code != 409 {
		t.Fatalf("second cancellation %d", w.Code)
	}
	var status, reason, kitchen string
	a.db.QueryRow("SELECT status,cancelled_reason FROM dining_order_items WHERE id=? AND organization_id=?", item, org).Scan(&status, &reason)
	a.db.QueryRow("SELECT status FROM dining_kitchen_tickets WHERE id=? AND organization_id=?", ticket, org).Scan(&kitchen)
	if status != "cancelled" || reason != "Guest requested" || kitchen != "served" {
		t.Fatalf("inconsistent void %s %s %s", status, reason, kitchen)
	}
}
