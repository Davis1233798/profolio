package main

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestDiningPaymentsBackOfficeTenantAndSearch(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	admin := loginSite(t, a, "admin@suite.test", space, "dining")
	front := loginSite(t, a, "front@suite.test", space, "dining")
	otherSpace := token()
	other := loginSite(t, a, "admin@suite.test", otherSpace, "dining")
	if _, err := a.db.Exec("INSERT INTO dining_payments(id,organization_id,bill_id,amount,payment_method,split_index) VALUES(?,?,?,120,'cash',2)", "payment-local", org, "bill-local"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.db.Exec("INSERT INTO dining_payments(id,organization_id,bill_id,amount,payment_method,split_index) VALUES(?,?,?,220,'card',1)", "payment-foreign", "org_test_"+otherSpace, "bill-foreign"); err != nil {
		t.Fatal(err)
	}
	path := "/api/stations/dining/data?view=back&dataset=payments&search=payment-local"
	w := request(a, http.MethodGet, path, nil, admin...)
	if w.Code != http.StatusOK {
		t.Fatalf("payment data: %d %s", w.Code, w.Body.String())
	}
	var result struct {
		Data map[string][]map[string]any `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	rows := result.Data["payments"]
	if len(rows) != 1 || rows[0]["id"] != "payment-local" || rows[0]["billId"] != "bill-local" || rows[0]["paymentMethod"] != "cash" || rows[0]["splitIndex"] != float64(2) {
		t.Fatalf("unexpected payment rows: %#v", rows)
	}
	if w = request(a, http.MethodGet, "/api/stations/dining/data?view=front&dataset=payments&search=payment-local", nil, front...); w.Code != http.StatusNotFound {
		t.Fatalf("front saw payments: %d %s", w.Code, w.Body.String())
	}
	if w = request(a, http.MethodGet, path, nil, other...); w.Code != http.StatusOK {
		t.Fatalf("foreign query: %d", w.Code)
	} else {
		var v struct {
			Data map[string][]map[string]any `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil || len(v.Data["payments"]) != 0 {
			t.Fatalf("foreign data leak: %s", w.Body.String())
		}
	}
	if w = request(a, http.MethodGet, path, nil); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous status: %d", w.Code)
	}
}
