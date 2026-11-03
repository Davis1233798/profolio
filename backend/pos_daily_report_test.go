package main

import (
	"encoding/json"
	"net/url"
	"testing"
)

func TestPOSDailyReportTaipeiDateAndIsolation(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	office := loginSite(t, a, "office@suite.test", space, "pos")
	front := loginSite(t, a, "front@suite.test", space, "pos")
	other := loginSite(t, a, "admin@suite.test", token(), "pos")
	var store, shift, register, cashier string
	if e := a.db.QueryRow("SELECT store_id,id,register_id,cashier_id FROM pos_shifts WHERE organization_id=? LIMIT 1", org).Scan(&store, &shift, &register, &cashier); e != nil {
		t.Fatal(e)
	}
	for _, sale := range []struct {
		id, when string
		amount   int
	}{{"day-a", "2035-01-01T16:00:00Z", 100}, {"day-b", "2035-01-02T15:59:59Z", 200}, {"next-day", "2035-01-02T16:00:00Z", 400}} {
		_, e := a.db.Exec("INSERT INTO pos_sales(id,organization_id,receipt_number,store_id,register_id,shift_id,cashier_id,subtotal,total_amount,tender_amount,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'completed',?)", sale.id+space, org, sale.id+space, store, register, shift, cashier, sale.amount, sale.amount, sale.amount, sale.when)
		if e != nil {
			t.Fatal(e)
		}
	}
	_, e := a.db.Exec("INSERT INTO pos_refunds(id,organization_id,refund_number,original_sale_id,manager_id,reason,refund_amount,created_at) VALUES(?,?,?,?,?,?,?,?)", "refund-"+space, org, "REF-"+space, "day-a"+space, cashier, "test", 30, "2035-01-02T08:00:00Z")
	if e != nil {
		t.Fatal(e)
	}
	path := "/api/stations/pos/daily-report?storeId=" + url.QueryEscape(store) + "&date=2035-01-02"
	if w := request(a, "GET", path, nil, front...); w.Code != 403 {
		t.Fatalf("front %d", w.Code)
	}
	if w := request(a, "GET", path, nil, other...); w.Code != 404 {
		t.Fatalf("other tenant %d", w.Code)
	}
	w := request(a, "GET", path, nil, office...)
	if w.Code != 200 {
		t.Fatalf("report %d %s", w.Code, w.Body.String())
	}
	var value struct {
		Data struct {
			Gross   int `json:"grossSales"`
			Refund  int `json:"totalRefunds"`
			Net     int `json:"netSales"`
			Sales   int `json:"transactionCount"`
			Refunds int `json:"refundCount"`
		} `json:"data"`
	}
	if e := json.Unmarshal(w.Body.Bytes(), &value); e != nil {
		t.Fatal(e)
	}
	if value.Data.Gross != 300 || value.Data.Refund != 30 || value.Data.Net != 270 || value.Data.Sales != 2 || value.Data.Refunds != 1 {
		t.Fatalf("report %+v", value.Data)
	}
}
