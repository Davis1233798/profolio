package main

import (
	"net/url"
	"testing"
)

func TestPOSBarcodeTenantAndActive(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	front := loginSite(t, a, "front@suite.test", space, "pos")
	other := loginSite(t, a, "front@suite.test", token(), "pos")
	if _, e := a.db.Exec("INSERT INTO pos_catalog_items(id,organization_id,barcode,name,price,stock_quantity,is_active) VALUES('barcode-test',?,'barcode-unique-test','Example',100,1,1)", org); e != nil {
		t.Fatal(e)
	}
	path := "/api/stations/pos/barcode?code=" + url.QueryEscape("barcode-unique-test")
	if w := request(a, "GET", path, nil, front...); w.Code != 200 {
		t.Fatalf("own %d %s", w.Code, w.Body.String())
	}
	if w := request(a, "GET", path, nil, other...); w.Code != 404 {
		t.Fatalf("other %d", w.Code)
	}
	if _, e := a.db.Exec("UPDATE pos_catalog_items SET is_active=0 WHERE id='barcode-test'"); e != nil {
		t.Fatal(e)
	}
	if w := request(a, "GET", path, nil, front...); w.Code != 404 {
		t.Fatalf("inactive %d", w.Code)
	}
}
