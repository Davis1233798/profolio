package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"testing"
)

func TestDiningTableOpenAndSplitPayment(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	staff := loginSite(t, a, "front@suite.test", space, "dining")
	viewer := loginSite(t, a, "viewer@suite.test", space, "dining")
	other := loginSite(t, a, "admin@suite.test", token(), "dining")
	path := "/api/stations/dining/table"
	var table, session string
	if e := a.db.QueryRow("SELECT id FROM dining_tables WHERE organization_id=? AND status='vacant' LIMIT 1", org).Scan(&table); e != nil {
		t.Fatal(e)
	}
	if e := a.db.QueryRow("SELECT id FROM dining_table_sessions WHERE organization_id=? AND status='active' LIMIT 1", org).Scan(&session); e != nil {
		t.Fatal(e)
	}
	open := map[string]any{"action": "open", "tableId": table, "guests": 2, "idempotencyKey": "dining-open-0001"}
	if w := request(a, "POST", path, open, viewer...); w.Code != 403 {
		t.Fatalf("readonly %d", w.Code)
	}
	if w := request(a, "POST", path, open, other...); w.Code != 404 {
		t.Fatalf("foreign table %d", w.Code)
	}
	if w := request(a, "POST", path, open, staff...); w.Code != 200 {
		t.Fatalf("open %d %s", w.Code, w.Body.String())
	}
	if w := request(a, "POST", path, open, staff...); w.Code != 200 {
		t.Fatalf("open replay %d", w.Code)
	}
	var subtotal, rate int64
	a.db.QueryRow("SELECT COALESCE(SUM(i.line_total),0) FROM dining_order_items i JOIN dining_orders o ON o.id=i.order_id AND o.organization_id=i.organization_id WHERE o.organization_id=? AND o.session_id=? AND o.status='placed' AND i.status!='cancelled'", org, session).Scan(&subtotal)
	a.db.QueryRow("SELECT l.service_fee_rate FROM dining_table_sessions s JOIN dining_tables t ON t.id=s.table_id JOIN dining_locations l ON l.id=t.location_id WHERE s.organization_id=? AND s.id=?", org, session).Scan(&rate)
	total := subtotal + (subtotal*rate+50)/100
	data := request(a, "GET", "/api/stations/dining/data?view=front", nil, staff...)
	if data.Code != 200 {
		t.Fatalf("front data %d %s", data.Code, data.Body.String())
	}
	var snapshot struct {
		Data struct {
			BillSummaries []struct {
				SessionID string `json:"sessionId"`
				Subtotal  int64  `json:"subtotal"`
			} `json:"billSummaries"`
		} `json:"data"`
	}
	if e := json.Unmarshal(data.Body.Bytes(), &snapshot); e != nil {
		t.Fatal(e)
	}
	found := false
	for _, v := range snapshot.Data.BillSummaries {
		if v.SessionID == session && v.Subtotal == subtotal {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing authoritative bill summary for %s", session)
	}
	input := func(i int) map[string]any {
		return map[string]any{"action": "pay", "sessionId": session, "splitCount": 3, "method": "cash", "expectedTotal": total, "idempotencyKey": fmt.Sprintf("dining-pay-%08d", i)}
	}
	stale := input(99)
	stale["expectedTotal"] = total + 1
	if w := request(a, "POST", path, stale, staff...); w.Code != 409 {
		t.Fatalf("stale bill %d", w.Code)
	}
	var wg sync.WaitGroup
	type res struct {
		code, index int
		body        []byte
	}
	results := make(chan res, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			w := request(a, "POST", path, input(i), staff...)
			results <- res{w.Code, i, w.Body.Bytes()}
		}(i)
	}
	wg.Wait()
	close(results)
	ok, conflict, winner := 0, 0, 0
	var bill string
	for r := range results {
		if r.code == 200 {
			ok++
			winner = r.index
			var v struct {
				Data struct {
					BillID string `json:"billId"`
				} `json:"data"`
			}
			json.Unmarshal(r.body, &v)
			bill = v.Data.BillID
		} else if r.code == 409 {
			conflict++
		} else {
			t.Errorf("unexpected %d %s", r.code, r.body)
		}
	}
	if ok != 1 || conflict != 11 {
		t.Fatalf("success %d conflict %d", ok, conflict)
	}
	if w := request(a, "POST", path, input(winner), staff...); w.Code != 200 {
		t.Fatalf("payment retry %d", w.Code)
	}
	var n int
	var paid int64
	a.db.QueryRow("SELECT count(*),COALESCE(sum(amount),0) FROM dining_payments WHERE organization_id=? AND bill_id=?", org, bill).Scan(&n, &paid)
	if n != 3 || paid != total {
		t.Fatalf("payments %d total %d expected %d", n, paid, total)
	}
}
