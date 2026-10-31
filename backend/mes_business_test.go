package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"testing"
)

func TestMESBusinessConcurrencyPermissionsAndIdempotency(t *testing.T) {
	a := appForTest(t)
	space := token()
	admin := loginSite(t, a, "admin@suite.test", space, "mes")
	front := loginSite(t, a, "front@suite.test", space, "mes")
	readonly := loginSite(t, a, "viewer@suite.test", space, "mes")
	org := "org_test_" + space
	var wo, op string
	var target int
	if e := a.db.QueryRow("SELECT id,target_quantity FROM mes_work_orders WHERE organization_id=? AND status='released' AND materials_staged=1", org).Scan(&wo, &target); e != nil {
		t.Fatal(e)
	}
	if e := a.db.QueryRow("SELECT id FROM mes_operations WHERE organization_id=? AND work_order_id=? LIMIT 1", org, wo).Scan(&op); e != nil {
		t.Fatal(e)
	}
	path := "/api/stations/mes/business"
	start := map[string]any{"action": "start", "workOrderId": wo}
	if w := request(a, "POST", path, start, front...); w.Code != http.StatusForbidden {
		t.Fatalf("front start: %d %s", w.Code, w.Body.String())
	}
	if w := request(a, "POST", path, start, readonly...); w.Code != http.StatusForbidden {
		t.Fatalf("readonly start: %d", w.Code)
	}
	if w := request(a, "POST", path, start, admin...); w.Code != http.StatusOK {
		t.Fatalf("start: %d %s", w.Code, w.Body.String())
	}
	other := loginSite(t, a, "admin@suite.test", token(), "mes")
	if w := request(a, "POST", path, start, other...); w.Code != http.StatusNotFound {
		t.Fatalf("cross tenant: %d", w.Code)
	}
	var wg sync.WaitGroup
	statuses := make(chan int, 32)
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			w := request(a, "POST", path, map[string]any{"action": "report", "workOrderId": wo, "operationId": op, "goodQuantity": target, "scrapQuantity": 0, "idempotencyKey": fmt.Sprintf("race-%08d", i)}, front...)
			statuses <- w.Code
		}(i)
	}
	wg.Wait()
	close(statuses)
	success, conflicts := 0, 0
	for s := range statuses {
		switch s {
		case 200:
			success++
		case 409:
			conflicts++
		default:
			t.Errorf("unexpected status %d", s)
		}
	}
	if success != 1 || conflicts != 31 {
		t.Fatalf("expected one committed report, got %d success %d conflict", success, conflicts)
	}
	var good, reports, audits int
	if e := a.db.QueryRow("SELECT completed_quantity FROM mes_work_orders WHERE id=? AND organization_id=?", wo, org).Scan(&good); e != nil {
		t.Fatal(e)
	}
	a.db.QueryRow("SELECT count(*) FROM mes_production_reports WHERE organization_id=? AND work_order_id=?", org, wo).Scan(&reports)
	a.db.QueryRow("SELECT count(*) FROM audit_events WHERE organization_id=? AND entity_id=?", org, wo).Scan(&audits)
	if good != target || reports != 1 || audits != 2 {
		t.Fatalf("persisted counts: good=%d reports=%d audits=%d", good, reports, audits)
	}
	// Replaying the winner must return exactly its persisted response without another report.
	var key string
	if e := a.db.QueryRow("SELECT idempotency_key FROM mes_production_reports WHERE organization_id=? AND work_order_id=?", org, wo).Scan(&key); e != nil {
		t.Fatal(e)
	}
	input := map[string]any{"action": "report", "workOrderId": wo, "operationId": op, "goodQuantity": target, "scrapQuantity": 0, "idempotencyKey": key}
	replay := request(a, "POST", path, input, front...)
	if replay.Code != 200 {
		t.Fatalf("replay: %d %s", replay.Code, replay.Body.String())
	}
	var result struct {
		Data struct {
			ReportID string `json:"reportId"`
		} `json:"data"`
	}
	if json.Unmarshal(replay.Body.Bytes(), &result) != nil || result.Data.ReportID == "" {
		t.Fatal("missing replayed report id")
	}
	input["goodQuantity"] = 1
	if w := request(a, "POST", path, input, front...); w.Code != 409 {
		t.Fatalf("retry payload mismatch: %d", w.Code)
	}
	if w := request(a, "POST", path, input, readonly...); w.Code != 403 {
		t.Fatalf("readonly write: %d", w.Code)
	}
}
