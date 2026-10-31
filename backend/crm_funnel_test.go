package main

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestCRMFunnelRoleAndTenantScope(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	admin := loginSite(t, a, "admin@suite.test", space, "crm")
	office := loginSite(t, a, "office@suite.test", space, "crm")
	other := loginSite(t, a, "admin@suite.test", token(), "crm")
	who := func(cookies ...*http.Cookie) string {
		w := request(a, "GET", "/api/auth/me", nil, cookies...)
		var v struct {
			Data Identity `json:"data"`
		}
		if json.Unmarshal(w.Body.Bytes(), &v) != nil || w.Code != 200 {
			t.Fatal("identity")
		}
		return v.Data.UserID
	}
	adminID, officeID := who(admin...), who(office...)
	var stage string
	if e := a.db.QueryRow("SELECT id FROM crm_stages WHERE organization_id=? ORDER BY position LIMIT 1", org).Scan(&stage); e != nil {
		t.Fatal(e)
	}
	if _, e := a.db.Exec("DELETE FROM crm_opportunities WHERE organization_id=?", org); e != nil {
		t.Fatal(e)
	}
	for _, x := range []struct {
		id, owner string
		amount    int
	}{{"own", officeID, 100}, {"team", adminID, 200}} {
		if _, e := a.db.Exec("INSERT INTO crm_opportunities(id,organization_id,name,owner_id,stage_id,amount,weighted_amount) VALUES(?,?,?,?,?,?,?)", x.id, org, x.id, x.owner, stage, x.amount, x.amount/2); e != nil {
			t.Fatal(e)
		}
	}
	read := func(cookies ...*http.Cookie) (int64, int64) {
		w := request(a, "GET", "/api/stations/crm/data?view=back", nil, cookies...)
		var v struct {
			Data struct {
				Funnel []struct {
					Count  int64 `json:"opportunityCount"`
					Amount int64 `json:"totalAmount"`
				} `json:"salesFunnel"`
			} `json:"data"`
		}
		if e := json.Unmarshal(w.Body.Bytes(), &v); e != nil || w.Code != 200 {
			t.Fatalf("funnel %d %v %s", w.Code, e, w.Body.String())
		}
		var n, sum int64
		for _, row := range v.Data.Funnel {
			n += row.Count
			sum += row.Amount
		}
		return n, sum
	}
	if n, total := read(office...); n != 1 || total != 100 {
		t.Fatalf("office %d %d", n, total)
	}
	if n, total := read(admin...); n != 2 || total != 300 {
		t.Fatalf("admin %d %d", n, total)
	}
	if _, total := read(other...); total == 300 {
		t.Fatal("other tenant received team total")
	}
}
