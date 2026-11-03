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

func TestShopSnapshotOnlyCountsRefundsLinkedToPaidOrderItems(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	admin := loginSite(t, a, "admin@suite.test", space, "shop")
	read := func() map[string]int64 {
		w := request(a, http.MethodGet, "/api/stations/shop/operations-snapshot", nil, admin...)
		var result struct {
			Data map[string]int64 `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || w.Code != http.StatusOK {
			t.Fatalf("snapshot: %d %v %s", w.Code, err, w.Body.String())
		}
		return result.Data
	}
	before := read()
	for _, row := range []struct{ id, status string }{{"summary-paid", "paid"}, {"summary-unpaid", "pending"}} {
		if _, err := a.db.Exec("INSERT INTO shop_orders(id,organization_id,order_number,customer_email,shipping_address_json,subtotal,shipping_fee,total_amount,payment_status) VALUES(?,?,?,?,?,100,60,160,?)", row.id, org, row.id, "example@example.test", "{}", row.status); err != nil {
			t.Fatal(err)
		}
	}
	for _, row := range []struct{ id, order string }{{"summary-item", "summary-paid"}, {"summary-other-item", "summary-unpaid"}} {
		if _, err := a.db.Exec("INSERT INTO shop_order_items(id,organization_id,order_id,variant_id,product_name,variant_title,sku,unit_price,quantity,line_total) VALUES(?,?,?,'variant','Example','Default','EXAMPLE',100,1,100)", row.id, org, row.order); err != nil {
			t.Fatal(err)
		}
	}
	for _, row := range []struct {
		id, order, item string
		amount          int
	}{{"summary-valid", "summary-paid", "summary-item", 20}, {"summary-orphan", "missing-order", "summary-item", 30}, {"summary-unpaid-return", "summary-unpaid", "summary-other-item", 40}, {"summary-wrong-item", "summary-paid", "summary-other-item", 50}} {
		if _, err := a.db.Exec("INSERT INTO shop_returns(id,organization_id,order_id,order_item_id,quantity,reason,status,refund_amount) VALUES(?,?,?,?,1,'example','refunded',?)", row.id, org, row.order, row.item, row.amount); err != nil {
			t.Fatal(err)
		}
	}
	after := read()
	if after["paidRevenue"]-before["paidRevenue"] != 160 || after["refundedAmount"]-before["refundedAmount"] != 20 || after["netRevenue"]-before["netRevenue"] != 140 {
		t.Fatalf("unexpected summary before=%v after=%v", before, after)
	}
}
