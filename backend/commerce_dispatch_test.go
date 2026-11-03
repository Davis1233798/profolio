package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestStationCommerceOutboxRetriesAndTenantMapping(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	session := loginSite(t, a, "admin@suite.test", space, "shop")
	var variant string
	if e := a.db.QueryRow("SELECT id FROM shop_variants WHERE organization_id=? AND stock_quantity=1 LIMIT 1", org).Scan(&variant); e != nil {
		t.Fatal(e)
	}
	w := request(a, "POST", "/api/stations/shop/business", map[string]any{"action": "checkout", "variantId": variant, "quantity": 1, "idempotencyKey": "dispatch-checkout-1"}, session...)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var result struct {
		Data struct {
			OrderID string `json:"orderId"`
		} `json:"data"`
	}
	if e := json.Unmarshal(w.Body.Bytes(), &result); e != nil {
		t.Fatal(e)
	}
	w = request(a, "POST", "/api/stations/shop/business", map[string]any{"action": "pay", "orderId": result.Data.OrderID, "idempotencyKey": "dispatch-payment-1"}, session...)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/commerce/jobs" || r.Header.Get("Authorization") != "Bearer test-secret" {
			t.Error("bad gateway path or authentication")
		}
		var job struct {
			Tenant string `json:"tenant"`
			Event  string `json:"event_id"`
			Order  string `json:"order_id"`
		}
		if e := json.NewDecoder(r.Body).Decode(&job); e != nil {
			t.Error(e)
		}
		if job.Tenant != "station_"+digest(org)[:48] || len(job.Tenant) > 64 || job.Event != "shop.paid:"+result.Data.OrderID || job.Order != result.Data.OrderID {
			t.Errorf("unexpected gateway job: %#v", job)
		}
		if calls.Add(1) == 1 {
			w.WriteHeader(503)
			return
		}
		w.WriteHeader(202)
	}))
	defer server.Close()
	sent, e := a.dispatchStationCommerce(context.Background(), server.URL, "test-secret", server.Client())
	if e != nil || sent != 0 {
		t.Fatalf("first attempt %d %v", sent, e)
	}
	var status string
	var retries int
	if e := a.db.QueryRow("SELECT status,retry_count FROM outbox_events WHERE id=?", "shop.paid:"+result.Data.OrderID).Scan(&status, &retries); e != nil {
		t.Fatal(e)
	}
	if status != "pending" || retries != 1 {
		t.Fatalf("failure state %s %d", status, retries)
	}
	sent, e = a.dispatchStationCommerce(context.Background(), server.URL, "test-secret", server.Client())
	if e != nil || sent != 1 {
		t.Fatalf("retry %d %v", sent, e)
	}
	sent, e = a.dispatchStationCommerce(context.Background(), server.URL, "test-secret", server.Client())
	if e != nil || sent != 0 || calls.Load() != 2 {
		t.Fatalf("duplicate dispatch %d %d %v", sent, calls.Load(), e)
	}
	if _, e = a.dispatchStationCommerce(context.Background(), "http://user:pass@example.test", "test-secret", server.Client()); e == nil || !strings.Contains(e.Error(), "invalid") {
		t.Fatal("invalid gateway must fail")
	}
}
