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
	if _, e := a.db.Exec("INSERT INTO crm_quotes(id,organization_id,quote_number,opportunity_id) VALUES('team-quote',?,'QT-TEAM','team')", org); e != nil {
		t.Fatal(e)
	}
	if _, e := a.db.Exec("INSERT INTO crm_quote_items(id,organization_id,quote_id,item_name,quantity,unit_price,line_total) VALUES('team-line',?,'team-quote','Secret',1,200,200)", org); e != nil {
		t.Fatal(e)
	}
	response := request(a, "GET", "/api/stations/crm/data?view=back", nil, office...)
	var scoped struct {
		Data struct {
			Opportunities []struct {
				ID string `json:"id"`
			} `json:"opportunities"`
			Quotes []struct {
				ID string `json:"id"`
			} `json:"quotes"`
			Lines []struct {
				ID string `json:"id"`
			} `json:"quoteItems"`
		} `json:"data"`
	}
	if e := json.Unmarshal(response.Body.Bytes(), &scoped); e != nil || response.Code != 200 {
		t.Fatalf("scope data %d %v", response.Code, e)
	}
	for _, opp := range scoped.Data.Opportunities {
		if opp.ID == "team" {
			t.Fatal("foreign owner opportunity visible")
		}
	}
	for _, quote := range scoped.Data.Quotes {
		if quote.ID == "team-quote" {
			t.Fatal("foreign owner quote visible")
		}
	}
	for _, line := range scoped.Data.Lines {
		if line.ID == "team-line" {
			t.Fatal("foreign owner quote item visible")
		}
	}
	if w := request(a, "GET", "/api/stations/crm/print?kind=crm-quote&id=team-quote", nil, office...); w.Code != 404 {
		t.Fatalf("foreign quote print %d", w.Code)
	}
	if w := request(a, "GET", "/api/stations/crm/print?kind=crm-quote&id=team-quote", nil, admin...); w.Code != 200 {
		t.Fatalf("admin quote print %d", w.Code)
	}
	quote := map[string]any{"action": "create", "opportunityId": "team", "itemName": "Service", "quantity": 1, "unitPrice": 1, "idempotencyKey": "foreign-quote-01"}
	if w := request(a, "POST", "/api/stations/crm/quotes", quote, office...); w.Code != 403 {
		t.Fatalf("foreign quote write %d", w.Code)
	}
	stageChange := map[string]any{"action": "stage", "opportunityId": "team", "expectedStage": stage, "stageId": stage, "idempotencyKey": "foreign-stage-01"}
	if w := request(a, "POST", "/api/stations/crm/work", stageChange, office...); w.Code != 403 {
		t.Fatalf("foreign stage write %d", w.Code)
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
