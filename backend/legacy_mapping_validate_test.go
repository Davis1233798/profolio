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
	leadAndReport := map[string]any{
		"entries": []any{map[string]any{"source": "legacy-worker", "target": "org_test_" + space + "_office"}},
		"backup": map[string]any{"format": "business-suite/v1", "organizationId": "org_old", "tables": map[string]any{
			"mes_production_reports": []any{map[string]any{"organizationId": "org_old", "operatorId": "legacy-worker"}},
			"crm_leads":              []any{map[string]any{"organizationId": "org_old", "assignedTo": "legacy-worker"}},
		}},
	}
	if w := request(a, "POST", path, leadAndReport, admin...); w.Code != http.StatusOK {
		t.Fatalf("report and lead mapping %d %s", w.Code, w.Body.String())
	}
	leadAndReport["entries"] = []any{}
	if w := request(a, "POST", path, leadAndReport, admin...); w.Code != http.StatusBadRequest {
		t.Fatalf("omitted report and lead mapping %d", w.Code)
	}
	leadAndReport["entries"] = []any{map[string]any{"source": "legacy-worker", "target": "org_test_" + space + "_front"}}
	if w := request(a, "POST", path, leadAndReport, admin...); w.Code != http.StatusBadRequest {
		t.Fatalf("front-only lead assignee %d", w.Code)
	}
	leadAndReport["backup"].(map[string]any)["tables"].(map[string]any)["mes_production_reports"] = []any{map[string]any{"organizationId": "org_old"}}
	if w := request(a, "POST", path, leadAndReport, admin...); w.Code != http.StatusBadRequest {
		t.Fatalf("missing report operator %d", w.Code)
	}
	payload := func(target string) map[string]any {
		return map[string]any{"entries": []any{map[string]any{"source": "legacy-op", "target": target}}, "backup": map[string]any{"format": "business-suite/v1", "organizationId": "org_old", "tables": map[string]any{"crm_accounts": []any{map[string]any{"organizationId": "org_old", "ownerId": "legacy-op"}}, "shop_orders": []any{map[string]any{"organizationId": "org_old", "userId": "legacy-op"}}}}}
	}
	reservation := payload("org_test_" + space + "_office")
	reservation["backup"].(map[string]any)["tables"].(map[string]any)["shop_inventory_reservations"] = []any{map[string]any{"organizationId": "org_old", "sessionId": "usr_org_old_admin"}}
	if w := request(a, "POST", path, reservation, admin...); w.Code != http.StatusBadRequest {
		t.Fatalf("omitted reservation identity %d", w.Code)
	}
	reservation["backup"].(map[string]any)["tables"].(map[string]any)["shop_inventory_reservations"] = []any{map[string]any{"organizationId": "org_old", "sessionId": "client_session"}}
	if w := request(a, "POST", path, reservation, admin...); w.Code != http.StatusOK {
		t.Fatalf("opaque client session %d %s", w.Code, w.Body.String())
	}

	if w := request(a, "POST", path, payload("org_test_"+space+"_office"), admin...); w.Code != http.StatusOK {
		t.Fatalf("valid mapping %d %s", w.Code, w.Body.String())
	}
	missing := payload("org_test_" + space + "_office")
	missing["entries"] = []any{}
	if w := request(a, "POST", path, missing, admin...); w.Code != http.StatusBadRequest {
		t.Fatalf("omitted identity %d", w.Code)
	}
	malformed := payload("org_test_" + space + "_office")
	malformed["backup"].(map[string]any)["tables"].(map[string]any)["crm_accounts"] = []any{map[string]any{"organizationId": "org_old", "ownerId": 123}}
	if w := request(a, "POST", path, malformed, admin...); w.Code != http.StatusBadRequest {
		t.Fatalf("malformed identity %d", w.Code)
	}
	missingOwner := payload("org_test_" + space + "_office")
	missingOwner["backup"].(map[string]any)["tables"].(map[string]any)["crm_accounts"] = []any{map[string]any{"organizationId": "org_old"}}
	if w := request(a, "POST", path, missingOwner, admin...); w.Code != http.StatusBadRequest {
		t.Fatalf("missing required owner %d", w.Code)
	}
	foreignRow := payload("org_test_" + space + "_office")
	foreignRow["backup"].(map[string]any)["tables"].(map[string]any)["shop_orders"] = []any{map[string]any{"organizationId": "org_other", "userId": "legacy-op"}}
	if w := request(a, "POST", path, foreignRow, admin...); w.Code != http.StatusBadRequest {
		t.Fatalf("foreign source row %d", w.Code)
	}
	duplicate := payload("org_test_" + space + "_office")
	duplicate["entries"] = []any{map[string]any{"source": "legacy-op", "target": "org_test_" + space + "_front"}, map[string]any{"source": "legacy-op", "target": "org_test_" + space + "_front"}}
	if w := request(a, "POST", path, duplicate, admin...); w.Code != http.StatusBadRequest {
		t.Fatalf("duplicate source mapping %d", w.Code)
	}
	if w := request(a, "POST", path, payload("org_test_"+space+"_front"), admin...); w.Code != http.StatusBadRequest {
		t.Fatalf("front-only CRM mapping %d", w.Code)
	}
	if w := request(a, "POST", path, payload("org_test_"+otherSpace+"_admin"), admin...); w.Code != http.StatusBadRequest {
		t.Fatalf("foreign mapping %d", w.Code)
	}
	if w := request(a, "POST", path, payload("org_test_"+space+"_admin"), front...); w.Code != http.StatusForbidden {
		t.Fatalf("front caller %d", w.Code)
	}
	if _, err := a.db.Exec("UPDATE station_grants SET enabled=0 WHERE user_id=? AND site='shop'", "org_test_"+space+"_office"); err != nil {
		t.Fatal(err)
	}
	if w := request(a, "POST", path, payload("org_test_"+space+"_office"), admin...); w.Code != http.StatusBadRequest {
		t.Fatalf("revoked target %d", w.Code)
	}
}

func TestLegacyGrantSeesTransactionLocalRevocation(t *testing.T) {
	a := appForTest(t)
	space := token()
	loginSite(t, a, "admin@suite.test", space, "crm")
	org, user := "org_test_"+space, "org_test_"+space+"_office"
	tx, err := a.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	valid, err := validateLegacyGrant(tx, org, user, "crm", true)
	if err != nil || !valid {
		t.Fatalf("initial grant %v %v", valid, err)
	}
	if _, err = tx.Exec("UPDATE station_grants SET enabled=0 WHERE user_id=? AND site='crm'", user); err != nil {
		t.Fatal(err)
	}
	valid, err = validateLegacyGrant(tx, org, user, "crm", true)
	if err != nil || valid {
		t.Fatalf("revoked grant %v %v", valid, err)
	}
}
