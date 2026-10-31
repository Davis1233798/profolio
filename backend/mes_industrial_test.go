package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMESIndustrialTenantAndPermissions(t *testing.T) {
	a := appForTest(t)
	space := token()
	admin := loginSite(t, a, "admin@suite.test", space, "mes")
	front := loginSite(t, a, "front@suite.test", space, "mes")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/industrial/station_"+digest("org_test_" + space)[:48] || r.Header.Get("Authorization") != "Bearer test-secret" {
			t.Errorf("unexpected gateway request")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"measurements":[{"device":"test","value":1}]}`))
	}))
	defer server.Close()
	t.Setenv("INFRA_GATEWAY_URL", server.URL)
	t.Setenv("INFRA_GATEWAY_TOKEN", "test-secret")
	path := "/api/stations/mes/industrial"
	if w := request(a, "GET", path, nil, front...); w.Code != 403 {
		t.Fatalf("front %d", w.Code)
	}
	w := request(a, "GET", path, nil, admin...)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"device":"test"`) {
		t.Fatalf("admin %d %s", w.Code, w.Body.String())
	}
	t.Setenv("INFRA_GATEWAY_URL", "")
	if w := request(a, "GET", path, nil, admin...); w.Code != 503 {
		t.Fatalf("unconfigured %d", w.Code)
	}
}
