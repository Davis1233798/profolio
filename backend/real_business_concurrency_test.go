package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"testing"
)

// TestRealBusinessAPIConcurrency uses appForTest's per-test file database and
// drives the same authenticated business APIs used by the station UI. This
// verifies transactional correctness, not public or multi-node throughput.
func TestRealBusinessAPIConcurrency(t *testing.T) {
	t.Run("MES production report race and retry", func(t *testing.T) {
		a := appForTest(t)
		space := token()
		org := "org_test_" + space
		admin := loginSite(t, a, "admin@suite.test", space, "mes")
		front := loginSite(t, a, "front@suite.test", space, "mes")
		otherAdmin := loginSite(t, a, "admin@suite.test", token(), "mes")

		var workOrderID, productID string
		var target int
		if err := a.db.QueryRow(`SELECT id,product_id,target_quantity FROM mes_work_orders WHERE organization_id=? AND status='released' AND materials_staged=1 AND completed_quantity=0 AND scrapped_quantity=0 LIMIT 1`, org).Scan(&workOrderID, &productID, &target); err != nil {
			t.Fatalf("load staged work order: %v", err)
		}
		var operationID string
		if err := a.db.QueryRow(`SELECT id FROM mes_operations WHERE organization_id=? AND work_order_id=? ORDER BY sequence LIMIT 1`, org, workOrderID).Scan(&operationID); err != nil {
			t.Fatalf("load work-order operation: %v", err)
		}
		if target < 1 {
			t.Fatalf("invalid fixture target: %d", target)
		}
		var baselineProjectionEvents int
		if err := a.db.QueryRow(`SELECT count(*) FROM outbox_events WHERE organization_id=? AND event_type='mes.work-order.changed' AND json_extract(payload,'$.workOrderId')=?`, org, workOrderID).Scan(&baselineProjectionEvents); err != nil {
			t.Fatalf("count baseline MES projection events: %v", err)
		}
		start := request(a, http.MethodPost, "/api/stations/mes/business", map[string]any{"action": "start", "workOrderId": workOrderID}, admin...)
		if start.Code != http.StatusOK {
			t.Fatalf("start fixture work order: %d %s", start.Code, start.Body.String())
		}
		if foreign := request(a, http.MethodPost, "/api/stations/mes/business", map[string]any{"action": "report", "workOrderId": workOrderID, "operationId": operationID, "goodQuantity": target, "idempotencyKey": "foreign-mes-report-0001"}, otherAdmin...); foreign.Code != http.StatusNotFound {
			t.Fatalf("cross-tenant report status=%d body=%s", foreign.Code, foreign.Body.String())
		}

		const contenders = 32
		type outcome struct {
			status int
			body   []byte
			key    string
		}
		results := make(chan outcome, contenders)
		var wg sync.WaitGroup
		for i := 0; i < contenders; i++ {
			key := fmt.Sprintf("real-mes-report-%s-%02d", space[:12], i)
			wg.Add(1)
			go func(key string) {
				defer wg.Done()
				w := request(a, http.MethodPost, "/api/stations/mes/business", map[string]any{
					"action": "report", "workOrderId": workOrderID, "operationId": operationID,
					"goodQuantity": target, "scrapQuantity": 0, "idempotencyKey": key,
				}, front...)
				results <- outcome{status: w.Code, body: append([]byte(nil), w.Body.Bytes()...), key: key}
			}(key)
		}
		wg.Wait()
		close(results)
		successes, conflicts := 0, 0
		var winner outcome
		for result := range results {
			switch result.status {
			case http.StatusOK:
				successes++
				winner = result
			case http.StatusConflict:
				conflicts++
			default:
				t.Errorf("unexpected MES report status=%d body=%s", result.status, result.body)
			}
		}
		if successes != 1 || conflicts != contenders-1 {
			t.Fatalf("MES report race successes=%d conflicts=%d", successes, conflicts)
		}
		var report struct {
			Success bool `json:"success"`
			Data    struct {
				ReportID string `json:"reportId"`
			} `json:"data"`
		}
		if err := json.Unmarshal(winner.body, &report); err != nil || !report.Success || report.Data.ReportID == "" {
			t.Fatalf("invalid winning report response: err=%v body=%s", err, winner.body)
		}

		var actualProduct, status string
		var completed, scrapped, reportRows, outboxRows int
		if err := a.db.QueryRow(`SELECT product_id,status,completed_quantity,scrapped_quantity FROM mes_work_orders WHERE organization_id=? AND id=?`, org, workOrderID).Scan(&actualProduct, &status, &completed, &scrapped); err != nil {
			t.Fatal(err)
		}
		if actualProduct != productID || status != "completed" || completed != target || scrapped != 0 {
			t.Fatalf("MES work-order invariant product=%s status=%s completed=%d scrapped=%d target=%d", actualProduct, status, completed, scrapped, target)
		}
		if err := a.db.QueryRow(`SELECT count(*) FROM mes_production_reports WHERE organization_id=? AND work_order_id=?`, org, workOrderID).Scan(&reportRows); err != nil {
			t.Fatal(err)
		}
		if err := a.db.QueryRow(`SELECT count(*) FROM outbox_events WHERE organization_id=? AND event_type='mes.work-order.changed' AND json_extract(payload,'$.workOrderId')=?`, org, workOrderID).Scan(&outboxRows); err != nil {
			t.Fatalf("count MES projection events: %v", err)
		}
		if reportRows != 1 || outboxRows < baselineProjectionEvents+2 { // work-order and report triggers both emit projection events
			t.Fatalf("MES business rows reports=%d work-order projection events=%d baseline=%d", reportRows, outboxRows, baselineProjectionEvents)
		}

		replayBody := map[string]any{"action": "report", "workOrderId": workOrderID, "operationId": operationID, "goodQuantity": target, "scrapQuantity": 0, "idempotencyKey": winner.key}
		replay := request(a, http.MethodPost, "/api/stations/mes/business", replayBody, front...)
		var replayResult struct {
			Success bool `json:"success"`
			Data    struct {
				ReportID string `json:"reportId"`
			} `json:"data"`
		}
		if replay.Code != http.StatusOK || json.Unmarshal(replay.Body.Bytes(), &replayResult) != nil || !replayResult.Success || replayResult.Data.ReportID != report.Data.ReportID {
			t.Fatalf("MES same-key retry did not replay winner: %d %s", replay.Code, replay.Body.String())
		}
		var afterRetry int
		if err := a.db.QueryRow(`SELECT count(*) FROM mes_production_reports WHERE organization_id=? AND work_order_id=?`, org, workOrderID).Scan(&afterRetry); err != nil || afterRetry != 1 {
			t.Fatalf("MES retry changed report count=%d err=%v", afterRetry, err)
		}
	})

	t.Run("shop single-unit checkout race and retry", func(t *testing.T) {
		a := appForTest(t)
		space := token()
		org := "org_test_" + space
		admin := loginSite(t, a, "admin@suite.test", space, "shop")
		front := loginSite(t, a, "front@suite.test", space, "shop")
		otherAdmin := loginSite(t, a, "admin@suite.test", token(), "shop")

		var variantID, productID string
		var initialStock int
		if err := a.db.QueryRow(`SELECT id,product_id,stock_quantity FROM shop_variants WHERE organization_id=? AND stock_quantity=1 AND reserved_quantity=0 AND is_active=1 LIMIT 1`, org).Scan(&variantID, &productID, &initialStock); err != nil {
			t.Fatalf("load single-unit variant: %v", err)
		}
		if initialStock != 1 {
			t.Fatalf("expected one-unit fixture, got %d", initialStock)
		}
		if foreign := request(a, http.MethodPost, "/api/stations/shop/business", map[string]any{"action": "checkout", "variantId": variantID, "quantity": 1, "idempotencyKey": "foreign-shop-checkout-0001"}, otherAdmin...); foreign.Code != http.StatusNotFound {
			t.Fatalf("cross-tenant checkout status=%d body=%s", foreign.Code, foreign.Body.String())
		}

		const contenders = 32
		type outcome struct {
			status int
			body   []byte
			key    string
		}
		results := make(chan outcome, contenders)
		var wg sync.WaitGroup
		for i := 0; i < contenders; i++ {
			key := fmt.Sprintf("real-shop-checkout-%s-%02d", space[:12], i)
			wg.Add(1)
			go func(key string) {
				defer wg.Done()
				w := request(a, http.MethodPost, "/api/stations/shop/business", map[string]any{
					"action": "checkout", "variantId": variantID, "quantity": 1, "idempotencyKey": key,
				}, front...)
				results <- outcome{status: w.Code, body: append([]byte(nil), w.Body.Bytes()...), key: key}
			}(key)
		}
		wg.Wait()
		close(results)
		successes, conflicts := 0, 0
		var winner outcome
		for result := range results {
			switch result.status {
			case http.StatusOK:
				successes++
				winner = result
			case http.StatusConflict:
				conflicts++
			default:
				t.Errorf("unexpected shop checkout status=%d body=%s", result.status, result.body)
			}
		}
		if successes != 1 || conflicts != contenders-1 {
			t.Fatalf("shop checkout race successes=%d conflicts=%d", successes, conflicts)
		}
		var order struct {
			Success bool `json:"success"`
			Data    struct {
				OrderID string `json:"orderId"`
			} `json:"data"`
		}
		if err := json.Unmarshal(winner.body, &order); err != nil || !order.Success || order.Data.OrderID == "" {
			t.Fatalf("invalid winning checkout response: err=%v body=%s", err, winner.body)
		}

		var stock, orders, items, reservations int
		var paymentStatus string
		if err := a.db.QueryRow(`SELECT stock_quantity FROM shop_variants WHERE organization_id=? AND id=? AND product_id=?`, org, variantID, productID).Scan(&stock); err != nil {
			t.Fatal(err)
		}
		if err := a.db.QueryRow(`SELECT count(*),min(payment_status) FROM shop_orders WHERE organization_id=? AND id=?`, org, order.Data.OrderID).Scan(&orders, &paymentStatus); err != nil {
			t.Fatal(err)
		}
		if err := a.db.QueryRow(`SELECT count(*) FROM shop_order_items WHERE organization_id=? AND order_id=? AND variant_id=? AND quantity=1`, org, order.Data.OrderID, variantID).Scan(&items); err != nil {
			t.Fatal(err)
		}
		if err := a.db.QueryRow(`SELECT count(*) FROM shop_inventory_reservations WHERE organization_id=? AND cart_id=? AND variant_id=? AND quantity=1 AND status='active' AND datetime(expires_at)>CURRENT_TIMESTAMP`, org, order.Data.OrderID, variantID).Scan(&reservations); err != nil {
			t.Fatal(err)
		}
		if stock != 0 || orders != 1 || paymentStatus != "pending" || items != 1 || reservations != 1 {
			t.Fatalf("shop checkout invariant stock=%d orders=%d payment=%s items=%d activeReservations=%d", stock, orders, paymentStatus, items, reservations)
		}

		replayBody := map[string]any{"action": "checkout", "variantId": variantID, "quantity": 1, "idempotencyKey": winner.key}
		replay := request(a, http.MethodPost, "/api/stations/shop/business", replayBody, front...)
		var replayOrder struct {
			Success bool `json:"success"`
			Data    struct {
				OrderID string `json:"orderId"`
			} `json:"data"`
		}
		if replay.Code != http.StatusOK || json.Unmarshal(replay.Body.Bytes(), &replayOrder) != nil || !replayOrder.Success || replayOrder.Data.OrderID != order.Data.OrderID {
			t.Fatalf("shop same-key retry did not replay winner: %d %s", replay.Code, replay.Body.String())
		}
		var afterOrders, afterItems, afterReservations int
		if err := a.db.QueryRow(`SELECT count(*) FROM shop_orders WHERE organization_id=? AND id=?`, org, order.Data.OrderID).Scan(&afterOrders); err != nil {
			t.Fatal(err)
		}
		if err := a.db.QueryRow(`SELECT count(*) FROM shop_order_items WHERE organization_id=? AND order_id=?`, org, order.Data.OrderID).Scan(&afterItems); err != nil {
			t.Fatal(err)
		}
		if err := a.db.QueryRow(`SELECT count(*) FROM shop_inventory_reservations WHERE organization_id=? AND cart_id=?`, org, order.Data.OrderID).Scan(&afterReservations); err != nil {
			t.Fatal(err)
		}
		if afterOrders != 1 || afterItems != 1 || afterReservations != 1 {
			t.Fatalf("shop retry duplicated business rows: orders=%d items=%d reservations=%d", afterOrders, afterItems, afterReservations)
		}
	})
}
