package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync"
	"testing"
)

const mesERPReceiptPostingPath = "/api/stations/erp/mes-receipt"

type mesERPReceiptPostingFixture struct {
	org         string
	space       string
	eventID     string
	productID   string
	itemID      string
	warehouseID string
	mappingID   string
	quantity    int
	mesAdmin    []*http.Cookie
	erpAdmin    []*http.Cookie
}

func prepareMESERPReceiptPostingFixture(t *testing.T, a *App) mesERPReceiptPostingFixture {
	t.Helper()
	finishedGoods := prepareFinishedGoodsOutboxFixture(t, a)
	space := finishedGoods.org[len("org_test_"):]
	erpAdmin := loginSite(t, a, "admin@suite.test", space, "erp")
	suffix := token()
	itemID, warehouseID := "erp-mes-receipt-item-"+suffix, "erp-mes-receipt-warehouse-"+suffix
	if _, err := a.db.Exec("INSERT INTO erp_items(id,organization_id,sku,name,unit,box_conversion_ratio,category,is_active) VALUES(?,?,?,?,?,1,'finished',1)", itemID, finishedGoods.org, itemID, "MES finished product", "PCS"); err != nil {
		t.Fatalf("insert ERP item: %v", err)
	}
	if _, err := a.db.Exec("INSERT INTO erp_warehouses(id,organization_id,code,name,is_active) VALUES(?,?,?,'Finished goods',1)", warehouseID, finishedGoods.org, warehouseID); err != nil {
		t.Fatalf("insert ERP warehouse: %v", err)
	}
	mapping := request(a, http.MethodPost, "/api/stations/erp/mes-integration", map[string]any{
		"action": "mapProduct", "mesProductId": finishedGoods.productID, "erpItemId": itemID,
		"warehouseId": warehouseID, "idempotencyKey": "mes-receipt-map-" + suffix,
	}, erpAdmin...)
	var mappingResult struct {
		Data struct {
			MappingID string `json:"mappingId"`
		} `json:"data"`
	}
	if err := json.Unmarshal(mapping.Body.Bytes(), &mappingResult); err != nil || mapping.Code != http.StatusOK || mappingResult.Data.MappingID == "" {
		t.Fatalf("create MES product mapping: %d %v %s", mapping.Code, err, mapping.Body.String())
	}
	receive := request(a, http.MethodPost, "/api/stations/mes/finished-goods", map[string]any{
		"action": "receive", "batchId": finishedGoods.batchID, "quantity": finishedGoods.quantity,
		"idempotencyKey": "mes-receipt-source-" + suffix,
	}, finishedGoods.admin...)
	if receive.Code != http.StatusOK {
		t.Fatalf("create MES receipt event: %d %s", receive.Code, receive.Body.String())
	}
	var eventID string
	if err := a.db.QueryRow("SELECT id FROM outbox_events WHERE organization_id=? AND event_type='mes.finished_goods.received' AND status='pending'", finishedGoods.org).Scan(&eventID); err != nil {
		t.Fatalf("pending MES receipt event missing: %v", err)
	}
	return mesERPReceiptPostingFixture{
		org: finishedGoods.org, space: space, eventID: eventID, productID: finishedGoods.productID,
		itemID: itemID, warehouseID: warehouseID, mappingID: mappingResult.Data.MappingID,
		quantity: finishedGoods.quantity, mesAdmin: finishedGoods.admin, erpAdmin: erpAdmin,
	}
}

func mesERPReceiptPostingRequest(eventID, mappingID string, unitCost int64, reason, key string) map[string]any {
	return map[string]any{
		"eventId": eventID, "mappingId": mappingID, "unitCost": unitCost,
		"reason": reason, "idempotencyKey": key,
	}
}

func postMESERPReceipt(a *App, cookies []*http.Cookie, input map[string]any) *httptest.ResponseRecorder {
	return request(a, http.MethodPost, mesERPReceiptPostingPath, input, cookies...)
}

func TestMESERPReceiptPostingPostsMappedFinishedGoodsAndDeduplicates(t *testing.T) {
	a := appForTest(t)
	f := prepareMESERPReceiptPostingFixture(t, a)
	input := mesERPReceiptPostingRequest(f.eventID, f.mappingID, 125, "Approved manufacturing cost record COST-204", "mes-erp-post-key-0001")
	first := postMESERPReceipt(a, f.erpAdmin, input)
	if first.Code != http.StatusOK {
		t.Fatalf("post MES receipt: %d %s", first.Code, first.Body.String())
	}
	var firstResult struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &firstResult); err != nil || len(firstResult.Data) == 0 {
		t.Fatalf("posting response: %v %s", err, first.Body.String())
	}
	var eventStatus string
	if err := a.db.QueryRow("SELECT status FROM outbox_events WHERE id=? AND organization_id=?", f.eventID, f.org).Scan(&eventStatus); err != nil || eventStatus != "processed" {
		t.Fatalf("event status=%q err=%v", eventStatus, err)
	}
	var ledgerRows, balance, unitCost, totalValue int
	if err := a.db.QueryRow("SELECT count(*),COALESCE(MAX(balance_after),0),COALESCE(MAX(unit_cost),0),COALESCE(MAX(total_value),0) FROM erp_stock_ledger WHERE organization_id=? AND item_id=? AND warehouse_id=?", f.org, f.itemID, f.warehouseID).Scan(&ledgerRows, &balance, &unitCost, &totalValue); err != nil {
		t.Fatalf("inspect posted ledger: %v", err)
	}
	wantValue := 125 * f.quantity
	if ledgerRows != 1 || balance != f.quantity || unitCost != 125 || totalValue != wantValue {
		t.Fatalf("posted ledger rows=%d balance=%d unitCost=%d totalValue=%d", ledgerRows, balance, unitCost, totalValue)
	}
	var costRows, costQuantity, costTotal, movingAverage int
	if err := a.db.QueryRow("SELECT count(*),COALESCE(MAX(total_quantity),0),COALESCE(MAX(total_cost),0),COALESCE(MAX(moving_average_cost),0) FROM erp_item_costing WHERE organization_id=? AND item_id=?", f.org, f.itemID).Scan(&costRows, &costQuantity, &costTotal, &movingAverage); err != nil {
		t.Fatalf("inspect item costing: %v", err)
	}
	if costRows != 1 || costQuantity != f.quantity || costTotal != wantValue || movingAverage != 125 {
		t.Fatalf("cost rows=%d quantity=%d total=%d average=%d", costRows, costQuantity, costTotal, movingAverage)
	}
	retry := postMESERPReceipt(a, f.erpAdmin, input)
	var retryResult struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(retry.Body.Bytes(), &retryResult); err != nil || retry.Code != http.StatusOK || !reflect.DeepEqual(firstResult.Data, retryResult.Data) {
		t.Fatalf("same-key retry changed result: %d %v %s", retry.Code, err, retry.Body.String())
	}
	if w := postMESERPReceipt(a, f.erpAdmin, mesERPReceiptPostingRequest(f.eventID, f.mappingID, 125, "Approved manufacturing cost record COST-204", "mes-erp-post-key-0002")); w.Code != http.StatusConflict {
		t.Fatalf("same event posted with a different key: %d %s", w.Code, w.Body.String())
	}
	if err := a.db.QueryRow("SELECT count(*) FROM erp_stock_ledger WHERE organization_id=? AND item_id=? AND warehouse_id=?", f.org, f.itemID, f.warehouseID).Scan(&ledgerRows); err != nil || ledgerRows != 1 {
		t.Fatalf("duplicate posting rows=%d err=%v", ledgerRows, err)
	}
}

func TestMESERPReceiptPostingRejectsTenantMappingAndCostErrors(t *testing.T) {
	a := appForTest(t)
	f := prepareMESERPReceiptPostingFixture(t, a)
	beforeMappings, beforeAudits, beforeIdempotency := mesERPMappingWriteCounts(t, a, f.org)
	foreignSpace := token()
	foreignAdmin := loginSite(t, a, "admin@suite.test", foreignSpace, "erp")
	invalid := []struct {
		name    string
		cookies []*http.Cookie
		input   map[string]any
	}{
		{"foreign tenant event", foreignAdmin, mesERPReceiptPostingRequest(f.eventID, f.mappingID, 125, "Approved cost record", "mes-erp-foreign-event-01")},
		{"wrong product mapping", f.erpAdmin, mesERPReceiptPostingRequest(f.eventID, "mesmap_does-not-map-this-product", 125, "Approved cost record", "mes-erp-wrong-map-0001")},
		{"missing cost reason", f.erpAdmin, mesERPReceiptPostingRequest(f.eventID, f.mappingID, 0, "", "mes-erp-no-reason-001")},
		{"cost over supported range", f.erpAdmin, mesERPReceiptPostingRequest(f.eventID, f.mappingID, 1000000001, "Approved cost record", "mes-erp-high-cost-001")},
	}
	for _, tc := range invalid {
		t.Run(tc.name, func(t *testing.T) {
			w := postMESERPReceipt(a, tc.cookies, tc.input)
			if w.Code < http.StatusBadRequest || w.Code >= http.StatusInternalServerError {
				t.Fatalf("invalid posting accepted or returned server error: %d %s", w.Code, w.Body.String())
			}
			mappings, audits, idempotency := mesERPMappingWriteCounts(t, a, f.org)
			if mappings != beforeMappings || audits != beforeAudits || idempotency != beforeIdempotency {
				t.Fatalf("rejected posting changed records: mappings=%d audits=%d idempotency=%d", mappings, audits, idempotency)
			}
			var status string
			if err := a.db.QueryRow("SELECT status FROM outbox_events WHERE id=? AND organization_id=?", f.eventID, f.org).Scan(&status); err != nil || status != "pending" {
				t.Fatalf("rejected posting changed event status=%q err=%v", status, err)
			}
			var ledgerRows, costRows int
			if err := a.db.QueryRow("SELECT count(*) FROM erp_stock_ledger WHERE organization_id=? AND item_id=?", f.org, f.itemID).Scan(&ledgerRows); err != nil {
				t.Fatal(err)
			}
			if err := a.db.QueryRow("SELECT count(*) FROM erp_item_costing WHERE organization_id=? AND item_id=?", f.org, f.itemID).Scan(&costRows); err != nil {
				t.Fatal(err)
			}
			if ledgerRows != 0 || costRows != 0 {
				t.Fatalf("rejected posting wrote inventory: ledger=%d costing=%d", ledgerRows, costRows)
			}
		})
	}
}

func TestMESERPReceiptPostingWriteFailureRollsBack(t *testing.T) {
	a := appForTest(t)
	f := prepareMESERPReceiptPostingFixture(t, a)
	beforeMappings, beforeAudits, beforeIdempotency := mesERPMappingWriteCounts(t, a, f.org)
	if _, err := a.db.Exec("CREATE TRIGGER test_fail_mes_receipt_process BEFORE UPDATE OF status ON outbox_events WHEN OLD.event_type='mes.finished_goods.received' AND NEW.status='processed' BEGIN SELECT RAISE(ABORT, 'simulated ERP receipt posting failure'); END"); err != nil {
		t.Fatalf("create outbox failure trigger: %v", err)
	}
	w := postMESERPReceipt(a, f.erpAdmin, mesERPReceiptPostingRequest(f.eventID, f.mappingID, 125, "Approved manufacturing cost record COST-204", "mes-erp-post-fail-0001"))
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("posting write failure should return 503, got %d %s", w.Code, w.Body.String())
	}
	mappings, audits, idempotency := mesERPMappingWriteCounts(t, a, f.org)
	if mappings != beforeMappings || audits != beforeAudits || idempotency != beforeIdempotency {
		t.Fatalf("failed posting left mapping/audit/idempotency state: mappings=%d audits=%d idempotency=%d", mappings, audits, idempotency)
	}
	var status string
	if err := a.db.QueryRow("SELECT status FROM outbox_events WHERE id=? AND organization_id=?", f.eventID, f.org).Scan(&status); err != nil || status != "pending" {
		t.Fatalf("failed posting event status=%q err=%v", status, err)
	}
	var ledgerRows, costRows int
	if err := a.db.QueryRow("SELECT count(*) FROM erp_stock_ledger WHERE organization_id=? AND item_id=? AND warehouse_id=?", f.org, f.itemID, f.warehouseID).Scan(&ledgerRows); err != nil {
		t.Fatal(err)
	}
	if err := a.db.QueryRow("SELECT count(*) FROM erp_item_costing WHERE organization_id=? AND item_id=?", f.org, f.itemID).Scan(&costRows); err != nil {
		t.Fatal(err)
	}
	if ledgerRows != 0 || costRows != 0 {
		t.Fatalf("failed posting left partial inventory: ledger=%d costing=%d", ledgerRows, costRows)
	}
	var postingRows int
	if err := a.db.QueryRow("SELECT count(*) FROM erp_mes_receipt_postings WHERE organization_id=? AND event_id=?", f.org, f.eventID).Scan(&postingRows); err != nil {
		t.Fatal(err)
	}
	if postingRows != 0 {
		t.Fatalf("failed posting left immutable posting rows=%d", postingRows)
	}
}

func TestMESERPReceiptPostingRejectsRevokedAdministratorGrants(t *testing.T) {
	for _, site := range []string{"mes", "erp"} {
		t.Run(site, func(t *testing.T) {
			a := appForTest(t)
			f := prepareMESERPReceiptPostingFixture(t, a)
			var userID string
			if err := a.db.QueryRow("SELECT user_id FROM station_accounts WHERE organization_id=? AND email=?", f.org, "admin@suite.test").Scan(&userID); err != nil {
				t.Fatalf("find administrator: %v", err)
			}
			if _, err := a.db.Exec("UPDATE station_grants SET role='operator' WHERE user_id=? AND site=?", userID, site); err != nil {
				t.Fatalf("revoke %s administrator grant: %v", site, err)
			}
			w := postMESERPReceipt(a, f.erpAdmin, mesERPReceiptPostingRequest(f.eventID, f.mappingID, 125, "Approved manufacturing cost record", "mes-erp-revoked-"+site))
			if w.Code != http.StatusForbidden {
				t.Fatalf("posting with revoked %s admin grant: got %d %s", site, w.Code, w.Body.String())
			}
			var status string
			if err := a.db.QueryRow("SELECT status FROM outbox_events WHERE organization_id=? AND id=?", f.org, f.eventID).Scan(&status); err != nil || status != "pending" {
				t.Fatalf("revoked grant changed event status=%q err=%v", status, err)
			}
			var postings, ledger int
			if err := a.db.QueryRow("SELECT count(*) FROM erp_mes_receipt_postings WHERE organization_id=? AND event_id=?", f.org, f.eventID).Scan(&postings); err != nil {
				t.Fatal(err)
			}
			if err := a.db.QueryRow("SELECT count(*) FROM erp_stock_ledger WHERE organization_id=? AND item_id=?", f.org, f.itemID).Scan(&ledger); err != nil {
				t.Fatal(err)
			}
			if postings != 0 || ledger != 0 {
				t.Fatalf("revoked grant wrote records: postings=%d ledger=%d", postings, ledger)
			}
		})
	}
}

func TestMESERPReceiptPostingConcurrentSameEventCreatesSinglePosting(t *testing.T) {
	a := appForTest(t)
	f := prepareMESERPReceiptPostingFixture(t, a)
	input := mesERPReceiptPostingRequest(f.eventID, f.mappingID, 125, "Approved manufacturing cost record", "mes-erp-concurrent-key-0001")
	const requests = 2
	start := make(chan struct{})
	responses := make([]*httptest.ResponseRecorder, requests)
	var wg sync.WaitGroup
	wg.Add(requests)
	for i := 0; i < requests; i++ {
		go func(i int) {
			defer wg.Done()
			<-start
			responses[i] = postMESERPReceipt(a, f.erpAdmin, input)
		}(i)
	}
	close(start)
	wg.Wait()

	successes := 0
	for i, w := range responses {
		if w == nil {
			t.Fatalf("request %d produced no response", i)
		}
		if w.Code == http.StatusOK {
			successes++
		} else if w.Code != http.StatusConflict && w.Code != http.StatusServiceUnavailable {
			t.Fatalf("request %d unexpected response: %d %s", i, w.Code, w.Body.String())
		}
	}
	if successes < 1 {
		t.Fatalf("both concurrent requests failed: %d %s; %d %s", responses[0].Code, responses[0].Body.String(), responses[1].Code, responses[1].Body.String())
	}
	var postings, ledger int
	if err := a.db.QueryRow("SELECT count(*) FROM erp_mes_receipt_postings WHERE organization_id=? AND event_id=?", f.org, f.eventID).Scan(&postings); err != nil {
		t.Fatal(err)
	}
	if err := a.db.QueryRow("SELECT count(*) FROM erp_stock_ledger WHERE organization_id=? AND item_id=? AND warehouse_id=? AND change_type='mes_receipt'", f.org, f.itemID, f.warehouseID).Scan(&ledger); err != nil {
		t.Fatal(err)
	}
	if postings != 1 || ledger != 1 {
		t.Fatalf("same event concurrent posting duplicated: postings=%d ledger=%d", postings, ledger)
	}
}
