package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
)

type businessLabResult struct {
	Site         string `json:"site"`
	Attempted    int    `json:"attempted"`
	Succeeded    int    `json:"succeeded"`
	Conflicts    int    `json:"conflicts"`
	Unknown      int    `json:"unknown"`
	BusinessRows int    `json:"businessRows"`
	Remaining    int    `json:"remaining"`
}

func businessLabRequest(ctx context.Context, app *App, method, path string, data any, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	b, _ := json.Marshal(data)
	req := httptest.NewRequest(method, "http://localhost"+path, bytes.NewReader(b)).WithContext(ctx)
	req.Header.Set("Content-Type", "application/json")
	for _, c := range cookies {
		req.AddCookie(c)
	}
	out := httptest.NewRecorder()
	app.ServeHTTP(out, req)
	return out
}

func runBusinessLab(ctx context.Context, manager *businessLabManager, site string, contenders int) (result businessLabResult, err error) {
	if (site != "mes" && site != "shop") || contenders < 1 || contenders > 32 {
		return result, errors.New("invalid business lab scenario")
	}
	lab, err := manager.acquire(ctx)
	if err != nil {
		return result, err
	}
	defer func() { err = errors.Join(err, lab.close()) }()
	space := token()
	org := "org_test_" + space
	login := func(email string) ([]*http.Cookie, error) {
		out := businessLabRequest(ctx, lab.app, "POST", "/api/auth/login", map[string]string{"email": email, "password": testPassword, "site": site}, &http.Cookie{Name: demoCookie, Value: space})
		if out.Code != http.StatusOK {
			return nil, fmt.Errorf("isolated login failed: %d", out.Code)
		}
		return out.Result().Cookies(), nil
	}
	admin, err := login("admin@suite.test")
	if err != nil {
		return result, err
	}
	front, err := login("front@suite.test")
	if err != nil {
		return result, err
	}
	var object, operation string
	var target int
	var command map[string]any
	if site == "mes" {
		err = lab.app.db.QueryRowContext(ctx, `SELECT w.id,w.target_quantity,o.id FROM mes_work_orders w JOIN mes_operations o ON o.organization_id=w.organization_id AND o.work_order_id=w.id WHERE w.organization_id=? AND w.status='released' AND w.materials_staged=1 AND w.completed_quantity=0 AND w.scrapped_quantity=0 ORDER BY w.id,o.sequence LIMIT 1`, org).Scan(&object, &target, &operation)
		if err != nil {
			return result, fmt.Errorf("isolated work order unavailable: %w", err)
		}
		start := businessLabRequest(ctx, lab.app, "POST", "/api/stations/mes/business", map[string]any{"action": "start", "workOrderId": object}, admin...)
		if start.Code != http.StatusOK {
			return result, fmt.Errorf("isolated work order start failed: %d", start.Code)
		}
		command = map[string]any{"action": "report", "workOrderId": object, "operationId": operation, "goodQuantity": target, "scrapQuantity": 0}
	} else {
		err = lab.app.db.QueryRowContext(ctx, `SELECT v.id FROM shop_variants v JOIN shop_products p ON p.organization_id=v.organization_id AND p.id=v.product_id WHERE v.organization_id=? AND v.stock_quantity=1 AND v.reserved_quantity=0 AND v.is_active=1 AND p.is_active=1 LIMIT 1`, org).Scan(&object)
		if err != nil {
			return result, fmt.Errorf("isolated single-unit variant unavailable: %w", err)
		}
		command = map[string]any{"action": "checkout", "variantId": object, "quantity": 1}
	}
	results := make(chan int, contenders)
	var wg sync.WaitGroup
	for i := 0; i < contenders; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			input := make(map[string]any, len(command)+1)
			for k, v := range command {
				input[k] = v
			}
			input["idempotencyKey"] = fmt.Sprintf("business-lab-%s-%02d", space[:12], i)
			w := businessLabRequest(ctx, lab.app, "POST", "/api/stations/"+site+"/business", input, front...)
			results <- w.Code
		}(i)
	}
	wg.Wait()
	close(results)
	result.Site = site
	result.Attempted = contenders
	for status := range results {
		switch status {
		case http.StatusOK:
			result.Succeeded++
		case http.StatusConflict:
			result.Conflicts++
		default:
			result.Unknown++
		}
	}
	if err = ctx.Err(); err != nil {
		return result, err
	}
	if site == "mes" {
		err = lab.app.db.QueryRowContext(ctx, `SELECT (SELECT COUNT(*) FROM mes_production_reports WHERE organization_id=? AND work_order_id=?),target_quantity-completed_quantity-scrapped_quantity FROM mes_work_orders WHERE organization_id=? AND id=?`, org, object, org, object).Scan(&result.BusinessRows, &result.Remaining)
	} else {
		err = lab.app.db.QueryRowContext(ctx, `SELECT (SELECT COUNT(*) FROM shop_order_items WHERE organization_id=? AND variant_id=?),stock_quantity FROM shop_variants WHERE organization_id=? AND id=?`, org, object, org, object).Scan(&result.BusinessRows, &result.Remaining)
	}
	if err != nil {
		return result, fmt.Errorf("cannot reconcile isolated business results: %w", err)
	}
	return result, nil
}
