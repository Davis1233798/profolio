package main

import (
	"encoding/json"
	"testing"
)

func TestPOSFrontReceiptScope(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	front := loginSite(t, a, "front@suite.test", space, "pos")
	admin := loginSite(t, a, "admin@suite.test", space, "pos")
	var me struct {
		Data Identity `json:"data"`
	}
	if e := json.Unmarshal(request(a, "GET", "/api/auth/me", nil, front...).Body.Bytes(), &me); e != nil {
		t.Fatal(e)
	}
	for _, row := range []struct{ id, owner string }{{"own-sale", me.Data.UserID}, {"team-sale", "different-cashier"}} {
		if _, e := a.db.Exec("INSERT INTO pos_sales(id,organization_id,receipt_number,store_id,register_id,shift_id,cashier_id,subtotal,total_amount,tender_amount) VALUES(?,?,?,'store','register','shift',?,10,10,10)", row.id, org, row.id, row.owner); e != nil {
			t.Fatal(e)
		}
	}
	if w := request(a, "GET", "/api/stations/pos/print?kind=pos-receipt&id=own-sale", nil, front...); w.Code != 200 {
		t.Fatalf("own %d %s", w.Code, w.Body.String())
	}
	if w := request(a, "GET", "/api/stations/pos/print?kind=pos-receipt&id=team-sale", nil, front...); w.Code != 404 {
		t.Fatalf("other cashier %d", w.Code)
	}
	if w := request(a, "GET", "/api/stations/pos/print?kind=pos-receipt&id=team-sale", nil, admin...); w.Code != 200 {
		t.Fatalf("admin %d", w.Code)
	}
	if w := request(a, "GET", "/api/stations/pos/print?kind=pos-shift&id=shift", nil, front...); w.Code != 403 {
		t.Fatalf("shift %d", w.Code)
	}
}
