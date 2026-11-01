package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
)

func TestDatasetPagingRespectsScopeAndTenant(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	front := loginSite(t, a, "front@suite.test", space, "erp")
	admin := loginSite(t, a, "admin@suite.test", space, "erp")
	other := loginSite(t, a, "admin@suite.test", token(), "erp")
	for i := 0; i < 501; i++ {
		_, err := a.db.Exec("INSERT INTO erp_items(id,organization_id,sku,name) VALUES(?,?,?,?)", fmt.Sprintf("paging-%d", i), org, fmt.Sprintf("paging-%d", i), "Paging")
		if err != nil {
			t.Fatal(err)
		}
	}
	page := func(path string, cookies []*http.Cookie) []map[string]any {
		w := request(a, "GET", path, nil, cookies...)
		if w.Code != 200 {
			t.Fatalf("status %d: %s", w.Code, w.Body.String())
		}
		var result struct {
			Data map[string][]map[string]any `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result.Data["items"]
	}
	first := page("/api/stations/erp/data?view=front&dataset=items&offset=0", front)
	second := page("/api/stations/erp/data?view=front&dataset=items&offset=500", front)
	if len(first) != 500 || len(second) == 0 {
		t.Fatalf("page lengths %d %d", len(first), len(second))
	}
	if first[0]["id"] == second[0]["id"] {
		t.Fatal("duplicate page")
	}
	for _, row := range second {
		if row["id"] == "paging-0" {
			goto isolated
		}
	}
	t.Fatal("oldest item missing")
isolated:
	for _, row := range page("/api/stations/erp/data?view=back&dataset=items", other) {
		if row["id"] == "paging-0" {
			t.Fatal("tenant leak")
		}
	}
	if w := request(a, "GET", "/api/stations/erp/data?view=front&dataset=invoices&offset=0", nil, front...); w.Code != 404 {
		t.Fatalf("front restricted data: %d", w.Code)
	}
	if w := request(a, "GET", "/api/stations/erp/data?view=back&dataset=items&offset=-1", nil, admin...); w.Code != 400 {
		t.Fatalf("invalid offset: %d", w.Code)
	}
}
