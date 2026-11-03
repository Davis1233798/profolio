package main

import (
	"net/http"
	"strings"
	"testing"
)

func TestLegacyMappingAccountsRequireAllStationAdminAndStayInTenant(t *testing.T) {
	a := appForTest(t)
	space := token()
	admin := loginSite(t, a, "admin@suite.test", space, "erp")
	front := loginSite(t, a, "front@suite.test", space, "erp")
	otherSpace := token()
	loginSite(t, a, "admin@suite.test", otherSpace, "erp")
	path := "/api/stations/erp/legacy-mapping-accounts"
	if w := request(a, "GET", path, nil, front...); w.Code != http.StatusForbidden {
		t.Fatalf("front %d", w.Code)
	}
	if _, err := a.db.Exec("INSERT INTO users(id,email,display_name) VALUES('ungrafted-user','ungranted@example.test','No grants')"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.db.Exec("INSERT INTO station_accounts(user_id,organization_id,email,password_hash) VALUES('ungrafted-user',?,'ungranted@example.test','unused')", "org_test_"+space); err != nil {
		t.Fatal(err)
	}
	w := request(a, "GET", path, nil, admin...)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "ungrafted-user") || strings.Contains(w.Body.String(), "org_test_"+otherSpace) || strings.Contains(w.Body.String(), "passwordHash") {
		t.Fatalf("accounts %d %s", w.Code, w.Body.String())
	}
	if _, err := a.db.Exec("UPDATE station_grants SET enabled=0 WHERE user_id=? AND site='mes'", "org_test_"+space+"_admin"); err != nil {
		t.Fatal(err)
	}
	if w = request(a, "GET", path, nil, admin...); w.Code != http.StatusForbidden {
		t.Fatalf("missing station grant %d", w.Code)
	}
}
