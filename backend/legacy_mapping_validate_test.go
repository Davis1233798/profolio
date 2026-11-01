package main

import (
	"net/http"
	"testing"
)

func TestLegacyMappingValidationEnforcesTenantAndGrants(t *testing.T) {
	a := appForTest(t)
	space := token()
	admin := loginSite(t, a, "admin@suite.test", space, "erp")
	front := loginSite(t, a, "front@suite.test", space, "erp")
	otherSpace := token()
	loginSite(t, a, "admin@suite.test", otherSpace, "erp")
	path := "/api/stations/erp/legacy-mapping-validate"
	payload := func(target string) map[string]any {
		return map[string]any{"entries": []any{map[string]any{"source": "legacy-op", "target": target, "sites": []string{"mes", "shop"}}}}
	}
	if w := request(a, "POST", path, payload("org_test_"+space+"_front"), admin...); w.Code != http.StatusOK {
		t.Fatalf("valid mapping %d %s", w.Code, w.Body.String())
	}
	if w := request(a, "POST", path, payload("org_test_"+otherSpace+"_admin"), admin...); w.Code != http.StatusBadRequest {
		t.Fatalf("foreign mapping %d", w.Code)
	}
	if w := request(a, "POST", path, payload("org_test_"+space+"_admin"), front...); w.Code != http.StatusForbidden {
		t.Fatalf("front caller %d", w.Code)
	}
	if _, err := a.db.Exec("UPDATE station_grants SET enabled=0 WHERE user_id=? AND site='shop'", "org_test_"+space+"_front"); err != nil {
		t.Fatal(err)
	}
	if w := request(a, "POST", path, payload("org_test_"+space+"_front"), admin...); w.Code != http.StatusBadRequest {
		t.Fatalf("revoked target %d", w.Code)
	}
}
