package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"testing"
)

func TestMESResolveDowntimeConcurrency(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	staff := loginSite(t, a, "front@suite.test", space, "mes")
	viewer := loginSite(t, a, "viewer@suite.test", space, "mes")
	other := loginSite(t, a, "admin@suite.test", token(), "mes")
	var center string
	if e := a.db.QueryRow("SELECT id FROM mes_work_centers WHERE organization_id=? LIMIT 1", org).Scan(&center); e != nil {
		t.Fatal(e)
	}
	path := "/api/stations/mes/operations"
	create := map[string]any{"action": "downtime", "centerId": center, "start": "2035-01-01T10:00:00Z", "reason": "Maintenance", "idempotencyKey": "downtime-create-01"}
	w := request(a, "POST", path, create, staff...)
	if w.Code != 200 {
		t.Fatalf("create %d %s", w.Code, w.Body.String())
	}
	var v struct {
		Data struct {
			ID string `json:"downtimeId"`
		} `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &v)
	input := func(i int) map[string]any {
		return map[string]any{"action": "resolveDowntime", "downtimeId": v.Data.ID, "end": "2035-01-01T11:30:00Z", "idempotencyKey": fmt.Sprintf("downtime-resolve-%08d", i)}
	}
	if w := request(a, "POST", path, input(99), viewer...); w.Code != 403 {
		t.Fatalf("readonly %d", w.Code)
	}
	if w := request(a, "POST", path, input(99), other...); w.Code != 404 {
		t.Fatalf("foreign %d", w.Code)
	}
	bad := input(98)
	bad["end"] = "2035-01-01T09:00:00Z"
	if w := request(a, "POST", path, bad, staff...); w.Code != 400 {
		t.Fatalf("bad end %d", w.Code)
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
			t.Errorf("resolve %d", r.code)
		}
	}
	if ok != 1 || conflicts != 11 {
		t.Fatalf("success %d conflicts %d", ok, conflicts)
	}
	if w := request(a, "POST", path, input(winner), staff...); w.Code != 200 {
		t.Fatalf("retry %d", w.Code)
	}
	var state string
	var minutes int
	a.db.QueryRow("SELECT status,duration_minutes FROM mes_downtime_events WHERE organization_id=? AND id=?", org, v.Data.ID).Scan(&state, &minutes)
	if state != "resolved" || minutes != 90 {
		t.Fatalf("state %s minutes %d", state, minutes)
	}
	next := map[string]any{"action": "downtime", "centerId": center, "start": "2035-01-01T11:30:00Z", "reason": "Follow up", "idempotencyKey": "downtime-next-0001"}
	if w := request(a, "POST", path, next, staff...); w.Code != 200 {
		t.Fatalf("next event %d %s", w.Code, w.Body.String())
	}
}
