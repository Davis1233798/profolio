package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"testing"
)

func TestMESMaterialQualityAndDowntime(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	admin := loginSite(t, a, "admin@suite.test", space, "mes")
	staff := loginSite(t, a, "front@suite.test", space, "mes")
	viewer := loginSite(t, a, "viewer@suite.test", space, "mes")
	other := loginSite(t, a, "admin@suite.test", token(), "mes")
	path := "/api/stations/mes/operations"
	var wo, op, lot, center string
	if e := a.db.QueryRow("SELECT id FROM mes_work_orders WHERE organization_id=? LIMIT 1", org).Scan(&wo); e != nil {
		t.Fatal(e)
	}
	a.db.QueryRow("SELECT id FROM mes_operations WHERE organization_id=? AND work_order_id=? LIMIT 1", org, wo).Scan(&op)
	a.db.QueryRow("SELECT id FROM mes_material_lots WHERE organization_id=? AND material_sku='RAW-ALUM-6061' LIMIT 1", org).Scan(&lot)
	a.db.QueryRow("SELECT id FROM mes_work_centers WHERE organization_id=? LIMIT 1", org).Scan(&center)
	// Reproduce an older workspace whose staged flag did not match its BOM.
	if _, e := a.db.Exec("DELETE FROM mes_work_order_materials WHERE organization_id=? AND work_order_id=? AND material_sku='RAW-THERMAL-PASTE'", org, wo); e != nil {
		t.Fatal(e)
	}
	if _, e := a.db.Exec("UPDATE mes_work_order_materials SET returned_quantity=10,net_quantity=190 WHERE organization_id=? AND work_order_id=? AND material_sku='RAW-ALUM-6061'", org, wo); e != nil {
		t.Fatal(e)
	}
	if w := request(a, "POST", "/api/stations/mes/business", map[string]any{"action": "start", "workOrderId": wo}, admin...); w.Code != 409 {
		t.Fatalf("stale staging flag accepted %d", w.Code)
	}
	create := map[string]any{"action": "createLot", "materialSku": "RAW-THERMAL-PASTE", "lotNumber": "DEMO-THERMAL", "lotQuantity": 100, "idempotencyKey": "mes-create-lot-01"}
	if w := request(a, "POST", path, create, staff...); w.Code != 403 {
		t.Fatalf("front lot %d", w.Code)
	}
	if w := request(a, "POST", path, create, other...); w.Code != 200 {
		t.Fatalf("other tenant should have own BOM %d", w.Code)
	}
	w := request(a, "POST", path, create, admin...)
	if w.Code != 200 {
		t.Fatalf("create lot %d %s", w.Code, w.Body.String())
	}
	var v struct {
		Data struct {
			LotID string `json:"lotId"`
		} `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &v)
	input := func(i int) map[string]any {
		return map[string]any{"action": "material", "workOrderId": wo, "lotId": v.Data.LotID, "issued": 100, "returned": 0, "idempotencyKey": fmt.Sprintf("mes-material-%08d", i)}
	}
	if w := request(a, "POST", path, input(99), viewer...); w.Code != 403 {
		t.Fatalf("readonly %d", w.Code)
	}
	if w := request(a, "POST", path, input(99), other...); w.Code != 404 {
		t.Fatalf("foreign order %d", w.Code)
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
			t.Errorf("material %d", r.code)
		}
	}
	if ok != 1 || conflicts != 11 {
		t.Fatalf("material success %d conflicts %d", ok, conflicts)
	}
	if w := request(a, "POST", path, input(winner), staff...); w.Code != 200 {
		t.Fatalf("replay %d", w.Code)
	}
	var staged, remaining int
	a.db.QueryRow("SELECT materials_staged FROM mes_work_orders WHERE organization_id=? AND id=?", org, wo).Scan(&staged)
	a.db.QueryRow("SELECT current_quantity FROM mes_material_lots WHERE organization_id=? AND id=?", org, v.Data.LotID).Scan(&remaining)
	if staged != 0 || remaining != 0 {
		t.Fatalf("incomplete staging %d remaining %d", staged, remaining)
	}
	aluminum := map[string]any{"action": "material", "workOrderId": wo, "lotId": lot, "issued": 10, "returned": 0, "idempotencyKey": "mes-material-alum-01"}
	if w := request(a, "POST", path, aluminum, staff...); w.Code != 200 {
		t.Fatalf("aluminum %d %s", w.Code, w.Body.String())
	}
	a.db.QueryRow("SELECT materials_staged FROM mes_work_orders WHERE organization_id=? AND id=?", org, wo).Scan(&staged)
	if staged != 1 {
		t.Fatal("complete BOM was not staged")
	}
	if w := request(a, "POST", "/api/stations/mes/business", map[string]any{"action": "start", "workOrderId": wo}, admin...); w.Code != 200 {
		t.Fatalf("start %d %s", w.Code, w.Body.String())
	}
	report := map[string]any{"action": "report", "workOrderId": wo, "operationId": op, "goodQuantity": 4, "scrapQuantity": 1, "idempotencyKey": "mes-report-quality-01"}
	if w := request(a, "POST", "/api/stations/mes/business", report, staff...); w.Code != 200 {
		t.Fatalf("report %d %s", w.Code, w.Body.String())
	}
	qc := map[string]any{"action": "quality", "workOrderId": wo, "sample": 5, "failed": 1, "disposition": "quarantine", "idempotencyKey": "mes-quality-0001"}
	quality := request(a, "POST", path, qc, staff...)
	if quality.Code != 200 {
		t.Fatalf("quality %d %s", quality.Code, quality.Body.String())
	}
	var qualityResult struct {
		Data struct {
			QualityCheckID string `json:"qualityCheckId"`
		} `json:"data"`
	}
	if err := json.Unmarshal(quality.Body.Bytes(), &qualityResult); err != nil || qualityResult.Data.QualityCheckID == "" {
		t.Fatalf("missing quality identifier: %v %s", err, quality.Body.String())
	}
	replay := request(a, "POST", path, qc, staff...)
	var replayResult struct {
		Data struct {
			QualityCheckID string `json:"qualityCheckId"`
		} `json:"data"`
	}
	if err := json.Unmarshal(replay.Body.Bytes(), &replayResult); err != nil || replay.Code != 200 || replayResult.Data.QualityCheckID != qualityResult.Data.QualityCheckID {
		t.Fatalf("quality retry: %d %v %s", replay.Code, err, replay.Body.String())
	}
	bad := map[string]any{"action": "quality", "workOrderId": wo, "sample": 5, "failed": 1, "disposition": "release", "idempotencyKey": "mes-quality-0002"}
	if w := request(a, "POST", path, bad, staff...); w.Code != 400 {
		t.Fatalf("failed release %d", w.Code)
	}
	downtime := func(i int) map[string]any {
		return map[string]any{"action": "downtime", "centerId": center, "start": "2035-01-01T10:00:00Z", "end": "2035-01-01T11:00:00Z", "reason": "Demo maintenance", "idempotencyKey": fmt.Sprintf("mes-downtime-%08d", i)}
	}
	results = make(chan result, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results <- result{request(a, "POST", path, downtime(i), staff...).Code, i}
		}(i)
	}
	wg.Wait()
	close(results)
	ok, conflicts = 0, 0
	for r := range results {
		if r.code == 200 {
			ok++
		} else if r.code == 409 {
			conflicts++
		} else {
			t.Errorf("downtime %d", r.code)
		}
	}
	if ok != 1 || conflicts != 11 {
		t.Fatalf("downtime success %d conflicts %d", ok, conflicts)
	}
}
