package main

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestOperationsSnapshotTenantAndScope(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	admin := loginSite(t, a, "admin@suite.test", space, "shop")
	front := loginSite(t, a, "front@suite.test", space, "shop")
	other := loginSite(t, a, "admin@suite.test", token(), "shop")
	mes := loginSite(t, a, "admin@suite.test", space, "mes")
	if _, e := a.db.Exec("INSERT INTO outbox_events(id,organization_id,event_type,payload,status,retry_count) VALUES('test-event',?,'shop.paid','{}','pending',2)", org); e != nil {
		t.Fatal(e)
	}
	path := "/api/stations/shop/operations-snapshot"
	if w := request(a, "GET", path, nil, front...); w.Code != 403 {
		t.Fatalf("front %d", w.Code)
	}
	read := func(cookies ...*http.Cookie) map[string]int64 {
		w := request(a, "GET", path, nil, cookies...)
		var v struct {
			Data map[string]int64 `json:"data"`
		}
		if e := json.Unmarshal(w.Body.Bytes(), &v); e != nil || w.Code != 200 {
			t.Fatalf("snapshot %d %v", w.Code, e)
		}
		return v.Data
	}
	if data := read(admin...); data["pendingOutbox"] != 1 || data["retryingOutbox"] != 1 {
		t.Fatalf("own snapshot %+v", data)
	}
	if data := read(other...); data["pendingOutbox"] != 0 {
		t.Fatalf("foreign snapshot %+v", data)
	}
	if w := request(a, "GET", "/api/stations/mes/operations-snapshot", nil, mes...); w.Code != 200 {
		t.Fatalf("mes snapshot %d %s", w.Code, w.Body.String())
	}
	if w := request(a, "POST", path, nil, admin...); w.Code != 405 {
		t.Fatalf("method %d", w.Code)
	}
}
