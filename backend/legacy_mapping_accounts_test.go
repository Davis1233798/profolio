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
	w := request(a, "GET", path, nil, admin...)
	if w.Code != http.StatusOK || strings.Contains(w.Body.String(), "org_test_"+otherSpace) || strings.Contains(w.Body.String(), "passwordHash") {
		t.Fatalf("accounts %d %s", w.Code, w.Body.String())
	}
	if _, err := a.db.Exec("UPDATE station_grants SET enabled=0 WHERE user_id=? AND site='mes'", "org_test_"+space+"_admin"); err != nil {
		t.Fatal(err)
	}
	if w = request(a, "GET", path, nil, admin...); w.Code != http.StatusForbidden {
		t.Fatalf("missing station grant %d", w.Code)
	}
}
