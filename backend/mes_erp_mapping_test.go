package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync"
	"testing"
)

const mesERPMappingPath = "/api/stations/erp/mes-integration"

type mesERPMappingFixture struct {
	org              string
	admin            []*http.Cookie
	product1         string
	product2         string
	item1            string
	item2            string
	itemWrongUnit    string
	warehouse        string
	foreignProduct   string
	foreignItem      string
	foreignWarehouse string
}

func prepareMESERPMappingFixture(t *testing.T, a *App) mesERPMappingFixture {
	t.Helper()
	space := token()
	org := "org_test_" + space
	_ = loginSite(t, a, "admin@suite.test", space, "mes")
	admin := loginSite(t, a, "admin@suite.test", space, "erp")
	foreignSpace := token()
	_ = loginSite(t, a, "admin@suite.test", foreignSpace, "mes")
	_ = loginSite(t, a, "admin@suite.test", foreignSpace, "erp")
	foreignOrg := "org_test_" + foreignSpace
	localSuffix, foreignSuffix := token(), token()
	f := mesERPMappingFixture{
		org:              org,
		admin:            admin,
		product1:         "mes-map-product-1-" + localSuffix,
		product2:         "mes-map-product-2-" + localSuffix,
		item1:            "erp-map-item-1-" + localSuffix,
		item2:            "erp-map-item-2-" + localSuffix,
		itemWrongUnit:    "erp-map-item-unit-" + localSuffix,
		warehouse:        "erp-map-warehouse-" + localSuffix,
		foreignProduct:   "mes-map-product-" + foreignSuffix,
		foreignItem:      "erp-map-item-" + foreignSuffix,
		foreignWarehouse: "erp-map-warehouse-" + foreignSuffix,
	}
	for _, product := range []string{f.product1, f.product2} {
		if _, err := a.db.Exec("INSERT INTO mes_products(id,organization_id,sku,name,unit,status) VALUES(?,?,?,?,'PCS','active')", product, org, product, "Mapping test product"); err != nil {
			t.Fatalf("insert MES product: %v", err)
		}
	}
	for _, item := range []struct{ id, unit string }{{f.item1, "PCS"}, {f.item2, "PCS"}, {f.itemWrongUnit, "BOX"}} {
		if _, err := a.db.Exec("INSERT INTO erp_items(id,organization_id,sku,name,unit,box_conversion_ratio,category,is_active) VALUES(?,?,?,?,?,1,'general',1)", item.id, org, item.id, "Mapping test item", item.unit); err != nil {
			t.Fatalf("insert ERP item: %v", err)
		}
	}
	if _, err := a.db.Exec("INSERT INTO erp_warehouses(id,organization_id,code,name,is_active) VALUES(?,?,?,'Mapping test warehouse',1)", f.warehouse, org, f.warehouse); err != nil {
		t.Fatalf("insert ERP warehouse: %v", err)
	}
	if _, err := a.db.Exec("INSERT INTO mes_products(id,organization_id,sku,name,unit,status) VALUES(?,?,?,?,'PCS','active')", f.foreignProduct, foreignOrg, f.foreignProduct, "Foreign mapping product"); err != nil {
		t.Fatalf("insert foreign MES product: %v", err)
	}
	if _, err := a.db.Exec("INSERT INTO erp_items(id,organization_id,sku,name,unit,box_conversion_ratio,category,is_active) VALUES(?,?,?,?,'PCS',1,'general',1)", f.foreignItem, foreignOrg, f.foreignItem, "Foreign mapping item"); err != nil {
		t.Fatalf("insert foreign ERP item: %v", err)
	}
	if _, err := a.db.Exec("INSERT INTO erp_warehouses(id,organization_id,code,name,is_active) VALUES(?,?,?,'Foreign mapping warehouse',1)", f.foreignWarehouse, foreignOrg, f.foreignWarehouse); err != nil {
		t.Fatalf("insert foreign ERP warehouse: %v", err)
	}
	return f
}

func mapMESProductRequest(mesProductID, erpItemID, warehouseID, key string) map[string]any {
	return map[string]any{
		"action": "mapProduct", "mesProductId": mesProductID, "erpItemId": erpItemID,
		"warehouseId": warehouseID, "idempotencyKey": key,
	}
}

func postMESProductMapping(a *App, cookies []*http.Cookie, requestBody map[string]any) *httptest.ResponseRecorder {
	return request(a, http.MethodPost, mesERPMappingPath, requestBody, cookies...)
}

func mesERPMappingWriteCounts(t *testing.T, a *App, org string) (mappings, audits, idempotency int) {
	t.Helper()
	for _, check := range []struct {
		query string
		out   *int
	}{
		{"SELECT count(*) FROM mes_erp_product_mappings WHERE organization_id=?", &mappings},
		{"SELECT count(*) FROM audit_events WHERE organization_id=?", &audits},
		{"SELECT count(*) FROM idempotency_keys WHERE organization_id=?", &idempotency},
	} {
		if err := a.db.QueryRow(check.query, org).Scan(check.out); err != nil {
			t.Fatalf("count mapping transaction rows: %v", err)
		}
	}
	return
}

func TestMESERPProductMappingCreateRetryAndVersionUpdate(t *testing.T) {
	a := appForTest(t)
	f := prepareMESERPMappingFixture(t, a)
	firstRequest := mapMESProductRequest(f.product1, f.item1, f.warehouse, "map-product-key-0001")
	first := postMESProductMapping(a, f.admin, firstRequest)
	if first.Code != http.StatusOK {
		t.Fatalf("create product mapping: %d %s", first.Code, first.Body.String())
	}
	var firstResult struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &firstResult); err != nil || len(firstResult.Data) == 0 {
		t.Fatalf("mapping response: %v %s", err, first.Body.String())
	}
	retry := postMESProductMapping(a, f.admin, firstRequest)
	var retryResult struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(retry.Body.Bytes(), &retryResult); err != nil || retry.Code != http.StatusOK || !reflect.DeepEqual(firstResult.Data, retryResult.Data) {
		t.Fatalf("same-key retry did not return original result: %d %v %s", retry.Code, err, retry.Body.String())
	}
	changedWithSameKey := mapMESProductRequest(f.product1, f.item2, f.warehouse, "map-product-key-0001")
	if w := postMESProductMapping(a, f.admin, changedWithSameKey); w.Code != http.StatusConflict {
		t.Fatalf("changed content reused mapping key: %d %s", w.Code, w.Body.String())
	}
	rows, err := a.db.Query("SELECT erp_item_id,warehouse_id,version,is_active FROM mes_erp_product_mappings WHERE organization_id=? AND mes_product_id=? ORDER BY version", f.org, f.product1)
	if err != nil {
		t.Fatalf("query mapping history: %v", err)
	}
	type mappingVersion struct {
		item, warehouse string
		version, active int
	}
	var versions []mappingVersion
	for rows.Next() {
		var v mappingVersion
		if err := rows.Scan(&v.item, &v.warehouse, &v.version, &v.active); err != nil {
			rows.Close()
			t.Fatalf("scan mapping history: %v", err)
		}
		versions = append(versions, v)
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	if len(versions) != 1 || versions[0].item != f.item1 || versions[0].warehouse != f.warehouse || versions[0].version != 1 || versions[0].active != 1 {
		t.Fatalf("retry or changed-key request altered mapping history: %+v", versions)
	}
	update := postMESProductMapping(a, f.admin, mapMESProductRequest(f.product1, f.item2, f.warehouse, "map-product-key-0002"))
	if update.Code != http.StatusOK {
		t.Fatalf("change product mapping version: %d %s", update.Code, update.Body.String())
	}
	rows, err = a.db.Query("SELECT erp_item_id,warehouse_id,version,is_active FROM mes_erp_product_mappings WHERE organization_id=? AND mes_product_id=? ORDER BY version", f.org, f.product1)
	if err != nil {
		t.Fatalf("query updated mapping history: %v", err)
	}
	versions = nil
	for rows.Next() {
		var v mappingVersion
		if err := rows.Scan(&v.item, &v.warehouse, &v.version, &v.active); err != nil {
			rows.Close()
			t.Fatalf("scan updated mapping history: %v", err)
		}
		versions = append(versions, v)
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	if len(versions) != 2 || versions[0].item != f.item1 || versions[0].version != 1 || versions[0].active != 0 || versions[1].item != f.item2 || versions[1].version != 2 || versions[1].active != 1 {
		t.Fatalf("mapping update did not append one active version: %+v", versions)
	}
	independent := postMESProductMapping(a, f.admin, mapMESProductRequest(f.product2, f.item1, f.warehouse, "map-product-key-0003"))
	if independent.Code != http.StatusOK {
		t.Fatalf("different MES product mapping rejected: %d %s", independent.Code, independent.Body.String())
	}
	var active int
	if err := a.db.QueryRow("SELECT count(*) FROM mes_erp_product_mappings WHERE organization_id=? AND mes_product_id=? AND is_active=1", f.org, f.product1).Scan(&active); err != nil || active != 1 {
		t.Fatalf("mapping another product changed active mapping count=%d err=%v", active, err)
	}
}

func TestMESERPProductMappingRejectsForeignTenantAndUnitMismatch(t *testing.T) {
	a := appForTest(t)
	f := prepareMESERPMappingFixture(t, a)
	beforeMappings, beforeAudits, beforeIdempotency := mesERPMappingWriteCounts(t, a, f.org)
	invalidRequests := []struct {
		name string
		body map[string]any
	}{
		{"foreign MES product", mapMESProductRequest(f.foreignProduct, f.item1, f.warehouse, "map-foreign-prod-001")},
		{"foreign ERP item", mapMESProductRequest(f.product1, f.foreignItem, f.warehouse, "map-foreign-item-01")},
		{"foreign ERP warehouse", mapMESProductRequest(f.product1, f.item1, f.foreignWarehouse, "map-foreign-wh-001")},
		{"unit mismatch", mapMESProductRequest(f.product1, f.itemWrongUnit, f.warehouse, "map-wrong-unit-001")},
	}
	for _, tc := range invalidRequests {
		t.Run(tc.name, func(t *testing.T) {
			w := postMESProductMapping(a, f.admin, tc.body)
			if w.Code < http.StatusBadRequest || w.Code >= http.StatusInternalServerError {
				t.Fatalf("invalid mapping accepted or unexpected status: %d %s", w.Code, w.Body.String())
			}
			mappings, audits, idempotency := mesERPMappingWriteCounts(t, a, f.org)
			if mappings != beforeMappings || audits != beforeAudits || idempotency != beforeIdempotency {
				t.Fatalf("rejected mapping wrote state: mappings=%d audits=%d idempotency=%d", mappings, audits, idempotency)
			}
		})
	}
}

func TestMESERPProductMappingRequiresBothBackOfficeAdministrators(t *testing.T) {
	t.Run("non-admin caller", func(t *testing.T) {
		a := appForTest(t)
		f := prepareMESERPMappingFixture(t, a)
		front := loginSite(t, a, "front@suite.test", f.org[len("org_test_"):], "erp")
		beforeMappings, beforeAudits, beforeIdempotency := mesERPMappingWriteCounts(t, a, f.org)
		w := postMESProductMapping(a, front, mapMESProductRequest(f.product1, f.item1, f.warehouse, "map-no-admin-0001"))
		if w.Code != http.StatusForbidden {
			t.Fatalf("front-office caller was not forbidden: %d %s", w.Code, w.Body.String())
		}
		mappings, audits, idempotency := mesERPMappingWriteCounts(t, a, f.org)
		if mappings != beforeMappings || audits != beforeAudits || idempotency != beforeIdempotency {
			t.Fatalf("forbidden mapping wrote state: mappings=%d audits=%d idempotency=%d", mappings, audits, idempotency)
		}
	})
	t.Run("revoked MES grant", func(t *testing.T) {
		a := appForTest(t)
		f := prepareMESERPMappingFixture(t, a)
		beforeMappings, beforeAudits, beforeIdempotency := mesERPMappingWriteCounts(t, a, f.org)
		if _, err := a.db.Exec("UPDATE station_grants SET enabled=0 WHERE user_id=? AND site='mes'", f.org+"_admin"); err != nil {
			t.Fatal(err)
		}
		w := postMESProductMapping(a, f.admin, mapMESProductRequest(f.product1, f.item1, f.warehouse, "map-mes-revoked-01"))
		if w.Code != http.StatusForbidden {
			t.Fatalf("revoked MES grant was accepted: %d %s", w.Code, w.Body.String())
		}
		mappings, audits, idempotency := mesERPMappingWriteCounts(t, a, f.org)
		if mappings != beforeMappings || audits != beforeAudits || idempotency != beforeIdempotency {
			t.Fatalf("revoked MES grant wrote state: mappings=%d audits=%d idempotency=%d", mappings, audits, idempotency)
		}
	})
	t.Run("revoked ERP grant", func(t *testing.T) {
		a := appForTest(t)
		f := prepareMESERPMappingFixture(t, a)
		beforeMappings, beforeAudits, beforeIdempotency := mesERPMappingWriteCounts(t, a, f.org)
		if _, err := a.db.Exec("UPDATE station_grants SET enabled=0 WHERE user_id=? AND site='erp'", f.org+"_admin"); err != nil {
			t.Fatal(err)
		}
		w := postMESProductMapping(a, f.admin, mapMESProductRequest(f.product1, f.item1, f.warehouse, "map-erp-revoked-01"))
		if w.Code != http.StatusForbidden {
			t.Fatalf("revoked ERP grant was accepted: %d %s", w.Code, w.Body.String())
		}
		mappings, audits, idempotency := mesERPMappingWriteCounts(t, a, f.org)
		if mappings != beforeMappings || audits != beforeAudits || idempotency != beforeIdempotency {
			t.Fatalf("revoked ERP grant wrote state: mappings=%d audits=%d idempotency=%d", mappings, audits, idempotency)
		}
	})
}

func TestMESERPProductMappingAuditFailureRollsBackAllWrites(t *testing.T) {
	a := appForTest(t)
	f := prepareMESERPMappingFixture(t, a)
	beforeMappings, beforeAudits, beforeIdempotency := mesERPMappingWriteCounts(t, a, f.org)
	if _, err := a.db.Exec("CREATE TRIGGER test_fail_mes_erp_mapping_audit BEFORE INSERT ON audit_events WHEN NEW.action='erp.mes.mapProduct' BEGIN SELECT RAISE(ABORT, 'simulated mapping audit failure'); END"); err != nil {
		t.Fatalf("create audit failure trigger: %v", err)
	}
	w := postMESProductMapping(a, f.admin, mapMESProductRequest(f.product1, f.item1, f.warehouse, "map-audit-failure-01"))
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("audit write failure should return 503, got %d %s", w.Code, w.Body.String())
	}
	mappings, audits, idempotency := mesERPMappingWriteCounts(t, a, f.org)
	if mappings != beforeMappings || audits != beforeAudits || idempotency != beforeIdempotency {
		t.Fatalf("audit failure left partial mapping transaction: mappings=%d audits=%d idempotency=%d", mappings, audits, idempotency)
	}
}

func TestMESERPProductMappingConcurrentUpdatesKeepSingleActiveVersion(t *testing.T) {
	a := appForTest(t)
	f := prepareMESERPMappingFixture(t, a)
	start := make(chan struct{})
	statuses := make(chan int, 2)
	var wg sync.WaitGroup
	for i, item := range []string{f.item1, f.item2} {
		wg.Add(1)
		go func(i int, item string) {
			defer wg.Done()
			<-start
			key := []string{"map-concurrent-update-01", "map-concurrent-update-02"}[i]
			w := postMESProductMapping(a, f.admin, mapMESProductRequest(f.product1, item, f.warehouse, key))
			statuses <- w.Code
		}(i, item)
	}
	close(start)
	wg.Wait()
	close(statuses)
	successes := 0
	for status := range statuses {
		if status == http.StatusOK {
			successes++
		} else if status != http.StatusConflict && status != http.StatusServiceUnavailable {
			t.Fatalf("unexpected concurrent mapping status %d", status)
		}
	}
	if successes == 0 {
		t.Fatal("all concurrent mapping updates failed")
	}
	var rows, active, maxVersion int
	if err := a.db.QueryRow("SELECT count(*),COALESCE(sum(is_active),0),COALESCE(max(version),0) FROM mes_erp_product_mappings WHERE organization_id=? AND mes_product_id=?", f.org, f.product1).Scan(&rows, &active, &maxVersion); err != nil {
		t.Fatalf("inspect concurrent mapping versions: %v", err)
	}
	if rows != successes || active != 1 || maxVersion != successes {
		t.Fatalf("concurrent updates left inconsistent history: successes=%d rows=%d active=%d maxVersion=%d", successes, rows, active, maxVersion)
	}
}
