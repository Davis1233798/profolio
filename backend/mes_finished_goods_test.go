package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// These tests define the HTTP contract for traceable finished-goods batches.
// A report being completed is not a quality release; only explicitly released
// batch quantity may be received into MES finished-goods inventory.
func TestMESFinishedGoodsReleaseReceiptAndClose(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	admin := loginSite(t, a, "admin@suite.test", space, "mes")
	operator := loginSite(t, a, "front@suite.test", space, "mes")
	viewer := loginSite(t, a, "viewer@suite.test", space, "mes")
	foreign := loginSite(t, a, "admin@suite.test", token(), "mes")

	var wo, op, product string
	var target int
	if err := a.db.QueryRow("SELECT id,product_id,target_quantity FROM mes_work_orders WHERE organization_id=? AND status='released' AND materials_staged=1 LIMIT 1", org).Scan(&wo, &product, &target); err != nil {
		t.Fatal(err)
	}
	if err := a.db.QueryRow("SELECT id FROM mes_operations WHERE organization_id=? AND work_order_id=? LIMIT 1", org, wo).Scan(&op); err != nil {
		t.Fatal(err)
	}
	path := "/api/stations/mes/finished-goods"
	post := func(input map[string]any, cookies ...*http.Cookie) *httptest.ResponseRecorder {
		return request(a, http.MethodPost, path, input, cookies...)
	}
	command := func(action, key string) map[string]any {
		return map[string]any{"action": action, "idempotencyKey": key}
	}

	// Complete production establishes traceable good quantity, but must not
	// silently create available finished-goods stock or close the order.
	if w := request(a, "POST", "/api/stations/mes/business", map[string]any{"action": "start", "workOrderId": wo}, admin...); w.Code != http.StatusOK {
		t.Fatalf("start order: %d %s", w.Code, w.Body.String())
	}
	report := map[string]any{"action": "report", "workOrderId": wo, "operationId": op, "goodQuantity": target, "scrapQuantity": 0, "idempotencyKey": "fg-report-0000001"}
	w := request(a, "POST", "/api/stations/mes/business", report, operator...)
	if w.Code != http.StatusOK {
		t.Fatalf("complete production: %d %s", w.Code, w.Body.String())
	}
	var reportResult struct {
		Data struct {
			ReportID string `json:"reportId"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &reportResult); err != nil || reportResult.Data.ReportID == "" {
		t.Fatalf("missing report id: %v %s", err, w.Body.String())
	}
	var status string
	if err := a.db.QueryRow("SELECT status FROM mes_work_orders WHERE organization_id=? AND id=?", org, wo).Scan(&status); err != nil || status != "completed" {
		t.Fatalf("report status=%q err=%v", status, err)
	}

	// API contract: createBatch binds batchId to workOrderId/reportId and an
	// integer quantity; qualityDisposition explicitly releases/quarantines it;
	// receive posts released quantity to the MES finished-goods ledger; close
	// requires every good unit traceably received and all exceptions resolved.
	create := command("createBatch", "fg-create-batch-0001")
	create["workOrderId"], create["reportId"], create["batchNumber"], create["quantity"] = wo, reportResult.Data.ReportID, "FG-"+space, target
	if w := post(create, viewer...); w.Code != http.StatusForbidden {
		t.Fatalf("readonly batch creation: %d %s", w.Code, w.Body.String())
	}
	if w := post(create, foreign...); w.Code != http.StatusNotFound {
		t.Fatalf("foreign organization batch creation: %d %s", w.Code, w.Body.String())
	}
	created := post(create, admin...)
	if created.Code != http.StatusOK {
		t.Fatalf("create batch: %d %s", created.Code, created.Body.String())
	}
	var batchResult struct {
		Data struct {
			BatchID string `json:"batchId"`
			Status  string `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &batchResult); err != nil || batchResult.Data.BatchID == "" || batchResult.Data.Status != "pending_inspection" {
		t.Fatalf("unexpected batch result: err=%v body=%s", err, created.Body.String())
	}
	batchID := batchResult.Data.BatchID
	withoutInspection := map[string]any{"action": "qualityDisposition", "batchId": batchID, "passedQuantity": target, "failedQuantity": 0, "disposition": "release", "idempotencyKey": "fg-no-inspection-0001"}
	if w := post(withoutInspection, admin...); w.Code != http.StatusBadRequest {
		t.Fatalf("batch released without inspection evidence: %d %s", w.Code, w.Body.String())
	}
	failedInspection := "failed-inspection-" + space
	if _, err := a.db.Exec("INSERT INTO mes_quality_checks(id,organization_id,work_order_id,report_id,inspector_id,sample_quantity,passed_quantity,failed_quantity,status,disposition) VALUES(?,?,?,?,?,1,0,1,'quarantined','quarantine')", failedInspection, org, wo, reportResult.Data.ReportID, org+"_admin"); err != nil {
		t.Fatal(err)
	}
	incorrectRelease := map[string]any{"action": "qualityDisposition", "batchId": batchID, "qualityCheckId": failedInspection, "passedQuantity": target, "failedQuantity": 0, "disposition": "release", "idempotencyKey": "fg-failed-evidence-01"}
	if w := post(incorrectRelease, admin...); w.Code != http.StatusConflict {
		t.Fatalf("failed inspection used to release: %d %s", w.Code, w.Body.String())
	}
	otherReportInspection := "other-inspection-" + space
	if _, err := a.db.Exec("INSERT INTO mes_quality_checks(id,organization_id,work_order_id,report_id,inspector_id,sample_quantity,passed_quantity,failed_quantity,status,disposition) VALUES(?,?,?,NULL,?,1,1,0,'passed','release')", otherReportInspection, org, wo, org+"_admin"); err != nil {
		t.Fatal(err)
	}
	wrongReport := map[string]any{"action": "qualityDisposition", "batchId": batchID, "qualityCheckId": otherReportInspection, "passedQuantity": target, "failedQuantity": 0, "disposition": "release", "idempotencyKey": "fg-wrong-report-0001"}
	if w := post(wrongReport, admin...); w.Code != http.StatusNotFound {
		t.Fatalf("unlinked inspection used to release: %d %s", w.Code, w.Body.String())
	}

	receive := command("receive", "fg-receive-pending-0001")
	receive["batchId"], receive["quantity"] = batchID, target
	if w := post(receive, admin...); w.Code != http.StatusConflict {
		t.Fatalf("pending inspection was receivable: %d %s", w.Code, w.Body.String())
	}
	closeInput := command("close", "fg-close-premature-0001")
	closeInput["workOrderId"] = wo
	if w := post(closeInput, admin...); w.Code != http.StatusConflict {
		t.Fatalf("uninspected order was closable: %d %s", w.Code, w.Body.String())
	}

	// A failed inspection cannot be labeled released. Quarantine is a separate
	// disposition and does not contribute to available inventory.
	failed := command("qualityDisposition", "fg-qc-failed-0001")
	failed["batchId"], failed["passedQuantity"], failed["failedQuantity"], failed["disposition"] = batchID, target-1, 1, "release"
	if w := post(failed, admin...); w.Code != http.StatusBadRequest {
		t.Fatalf("failed inspection released: %d %s", w.Code, w.Body.String())
	}
	quarantine := command("qualityDisposition", "fg-qc-quarantine-0001")
	quarantine["batchId"], quarantine["passedQuantity"], quarantine["failedQuantity"], quarantine["disposition"] = batchID, target-1, 1, "quarantine"
	quarantine["qualityCheckId"] = failedInspection
	if w := post(quarantine, admin...); w.Code != http.StatusOK {
		t.Fatalf("quarantine disposition: %d %s", w.Code, w.Body.String())
	}
	if w := post(receive, admin...); w.Code != http.StatusConflict {
		t.Fatalf("quarantined batch was receivable: %d %s", w.Code, w.Body.String())
	}
	if w := post(closeInput, admin...); w.Code != http.StatusConflict {
		t.Fatalf("unresolved quarantine was closable: %d %s", w.Code, w.Body.String())
	}
	resolve := map[string]any{"action": "resolveQuarantine", "batchId": batchID, "disposition": "scrap", "reason": "Inspection rejection", "idempotencyKey": "fg-resolve-scrap-001"}
	if w := post(resolve, viewer...); w.Code != http.StatusForbidden {
		t.Fatalf("readonly resolved quarantine: %d %s", w.Code, w.Body.String())
	}
	if w := post(resolve, foreign...); w.Code != http.StatusNotFound {
		t.Fatalf("foreign resolved quarantine: %d %s", w.Code, w.Body.String())
	}
	if w := post(resolve, admin...); w.Code != http.StatusOK {
		t.Fatalf("scrap quarantine: %d %s", w.Code, w.Body.String())
	}
	if w := post(resolve, admin...); w.Code != http.StatusOK {
		t.Fatalf("scrap retry: %d %s", w.Code, w.Body.String())
	}
	if w := post(receive, admin...); w.Code != http.StatusConflict {
		t.Fatalf("scrapped batch was receivable: %d %s", w.Code, w.Body.String())
	}
	if w := post(closeInput, admin...); w.Code != http.StatusOK {
		t.Fatalf("resolved scrap prevented closure: %d %s", w.Code, w.Body.String())
	}
	var inventory, dispositions int
	if err := a.db.QueryRow("SELECT count(*) FROM mes_finished_goods_inventory WHERE organization_id=? AND batch_id=?", org, batchID).Scan(&inventory); err != nil {
		t.Fatal(err)
	}
	if err := a.db.QueryRow("SELECT count(*) FROM mes_finished_goods_quality_dispositions WHERE organization_id=? AND batch_id=?", org, batchID).Scan(&dispositions); err != nil || inventory != 0 || dispositions != 2 {
		t.Fatalf("scrap inventory=%d dispositions=%d err=%v", inventory, dispositions, err)
	}

	// This contract treats a batch as fully dispositioned only when its good
	// quantity is released and its failed quantity is explicitly scrapped or
	// reworked; this batch is modeled as fully passing for the happy path below
	// by creating a second order/report in a separate test.
	_ = product
}

func TestMESFinishedGoodsHappyPathIdempotencyAndBounds(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	admin := loginSite(t, a, "admin@suite.test", space, "mes")
	operator := loginSite(t, a, "front@suite.test", space, "mes")
	readonly := loginSite(t, a, "viewer@suite.test", space, "mes")
	other := loginSite(t, a, "admin@suite.test", token(), "mes")
	var wo, op string
	var target int
	if err := a.db.QueryRow("SELECT id,target_quantity FROM mes_work_orders WHERE organization_id=? AND status='released' AND materials_staged=1 LIMIT 1", org).Scan(&wo, &target); err != nil {
		t.Fatal(err)
	}
	if err := a.db.QueryRow("SELECT id FROM mes_operations WHERE organization_id=? AND work_order_id=? LIMIT 1", org, wo).Scan(&op); err != nil {
		t.Fatal(err)
	}
	if w := request(a, "POST", "/api/stations/mes/business", map[string]any{"action": "start", "workOrderId": wo}, admin...); w.Code != http.StatusOK {
		t.Fatalf("start: %d %s", w.Code, w.Body.String())
	}
	report := map[string]any{"action": "report", "workOrderId": wo, "operationId": op, "goodQuantity": target, "scrapQuantity": 0, "idempotencyKey": "fg-happy-report-0001"}
	rw := request(a, "POST", "/api/stations/mes/business", report, operator...)
	if rw.Code != http.StatusOK {
		t.Fatalf("report: %d %s", rw.Code, rw.Body.String())
	}
	var reportID string
	var reportData struct {
		Data struct {
			ReportID string `json:"reportId"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rw.Body.Bytes(), &reportData); err != nil {
		t.Fatal(err)
	}
	reportID = reportData.Data.ReportID
	path := "/api/stations/mes/finished-goods"
	create := map[string]any{"action": "createBatch", "workOrderId": wo, "reportId": reportID, "batchNumber": "FG-HAPPY-" + space, "quantity": target, "idempotencyKey": "fg-happy-create-0001"}
	if w := request(a, "POST", path, create, other...); w.Code != http.StatusNotFound {
		t.Fatalf("foreign tenant: %d %s", w.Code, w.Body.String())
	}
	created := request(a, "POST", path, create, admin...)
	if created.Code != http.StatusOK {
		t.Fatalf("create batch: %d %s", created.Code, created.Body.String())
	}
	var batchData struct {
		Data struct {
			BatchID string `json:"batchId"`
		} `json:"data"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &batchData); err != nil || batchData.Data.BatchID == "" {
		t.Fatalf("batch response: %v %s", err, created.Body.String())
	}
	batchID := batchData.Data.BatchID
	failedCheck := "fg-failed-check-" + space
	if _, err := a.db.Exec("INSERT INTO mes_quality_checks(id,organization_id,work_order_id,report_id,inspector_id,sample_quantity,passed_quantity,failed_quantity,status,disposition) VALUES(?,?,?,?,?,1,0,1,'quarantined','quarantine')", failedCheck, org, wo, reportID, org+"_admin"); err != nil {
		t.Fatal(err)
	}
	quarantine := map[string]any{"action": "qualityDisposition", "batchId": batchID, "passedQuantity": target - 1, "failedQuantity": 1, "disposition": "quarantine", "idempotencyKey": "fg-rework-quarantine-01"}
	quarantine["qualityCheckId"] = failedCheck
	if w := request(a, "POST", path, quarantine, admin...); w.Code != http.StatusOK {
		t.Fatalf("quarantine before rework: %d %s", w.Code, w.Body.String())
	}
	oldPassed := "fg-old-pass-" + space
	if _, err := a.db.Exec("INSERT INTO mes_quality_checks(id,organization_id,work_order_id,report_id,inspector_id,sample_quantity,passed_quantity,failed_quantity,status,disposition) VALUES(?,?,?,?,?,1,1,0,'passed','release')", oldPassed, org, wo, reportID, org+"_admin"); err != nil {
		t.Fatal(err)
	}
	rework := map[string]any{"action": "resolveQuarantine", "batchId": batchID, "disposition": "rework", "reason": "Correct defects", "idempotencyKey": "fg-rework-resolve-01"}
	if w := request(a, "POST", path, rework, admin...); w.Code != http.StatusOK {
		t.Fatalf("rework: %d %s", w.Code, w.Body.String())
	}
	if w := request(a, "POST", path, map[string]any{"action": "qualityDisposition", "batchId": batchID, "qualityCheckId": oldPassed, "passedQuantity": target, "failedQuantity": 0, "disposition": "release", "idempotencyKey": "fg-old-inspection-01"}, admin...); w.Code != http.StatusConflict {
		t.Fatalf("pre-rework inspection accepted: %d %s", w.Code, w.Body.String())
	}
	passedCheck := "fg-passed-check-" + space
	if _, err := a.db.Exec("INSERT INTO mes_quality_checks(id,organization_id,work_order_id,report_id,inspector_id,sample_quantity,passed_quantity,failed_quantity,status,disposition) VALUES(?,?,?,?,?,1,1,0,'passed','release')", passedCheck, org, wo, reportID, org+"_admin"); err != nil {
		t.Fatal(err)
	}
	if w := request(a, "POST", path, map[string]any{"action": "receive", "batchId": batchID, "quantity": target, "idempotencyKey": "fg-rework-pending-01"}, admin...); w.Code != http.StatusConflict {
		t.Fatalf("uninspected rework received: %d %s", w.Code, w.Body.String())
	}
	if w := request(a, "POST", path, create, admin...); w.Code != http.StatusOK {
		t.Fatalf("create replay: %d %s", w.Code, w.Body.String())
	}
	changedCreate := map[string]any{}
	for k, v := range create {
		changedCreate[k] = v
	}
	changedCreate["quantity"] = target - 1
	if w := request(a, "POST", path, changedCreate, admin...); w.Code != http.StatusConflict {
		t.Fatalf("changed retry payload: %d %s", w.Code, w.Body.String())
	}
	tooMuch := map[string]any{"action": "createBatch", "workOrderId": wo, "reportId": reportID, "batchNumber": "FG-OVER-" + space, "quantity": target + 1, "idempotencyKey": "fg-over-create-0001"}
	if w := request(a, "POST", path, tooMuch, admin...); w.Code != http.StatusConflict {
		t.Fatalf("batch exceeds report good quantity: %d %s", w.Code, w.Body.String())
	}
	additional := map[string]any{"action": "createBatch", "workOrderId": wo, "reportId": reportID, "batchNumber": "FG-EXTRA-" + space, "quantity": 1, "idempotencyKey": "fg-extra-create-0001"}
	if w := request(a, "POST", path, additional, admin...); w.Code != http.StatusConflict {
		t.Fatalf("cumulative batches exceeded report: %d %s", w.Code, w.Body.String())
	}

	qc := map[string]any{"action": "qualityDisposition", "batchId": batchID, "passedQuantity": target, "failedQuantity": 0, "disposition": "release", "idempotencyKey": "fg-happy-qc-0001"}
	qc["qualityCheckId"] = passedCheck
	if w := request(a, "POST", path, qc, other...); w.Code != http.StatusNotFound {
		t.Fatalf("foreign quality disposition: %d %s", w.Code, w.Body.String())
	}
	if w := request(a, "POST", path, qc, operator...); w.Code != http.StatusForbidden {
		t.Fatalf("operator quality release: %d %s", w.Code, w.Body.String())
	}
	if w := request(a, "POST", path, qc, readonly...); w.Code != http.StatusForbidden {
		t.Fatalf("readonly quality release: %d %s", w.Code, w.Body.String())
	}
	if w := request(a, "POST", path, qc, admin...); w.Code != http.StatusOK {
		t.Fatalf("quality release: %d %s", w.Code, w.Body.String())
	}
	qcChanged := map[string]any{}
	for k, v := range qc {
		qcChanged[k] = v
	}
	qcChanged["passedQuantity"] = target - 1
	if w := request(a, "POST", path, qcChanged, admin...); w.Code != http.StatusConflict {
		t.Fatalf("changed quality retry: %d %s", w.Code, w.Body.String())
	}

	receive := map[string]any{"action": "receive", "batchId": batchID, "quantity": target, "idempotencyKey": "fg-happy-receive-0001"}
	if w := request(a, "POST", path, receive, other...); w.Code != http.StatusNotFound {
		t.Fatalf("foreign receipt: %d %s", w.Code, w.Body.String())
	}
	if w := request(a, "POST", path, receive, admin...); w.Code != http.StatusOK {
		t.Fatalf("receive: %d %s", w.Code, w.Body.String())
	}
	if w := request(a, "POST", path, receive, admin...); w.Code != http.StatusOK {
		t.Fatalf("receive replay: %d %s", w.Code, w.Body.String())
	}
	changedReceive := map[string]any{}
	for k, v := range receive {
		changedReceive[k] = v
	}
	changedReceive["quantity"] = target - 1
	if w := request(a, "POST", path, changedReceive, admin...); w.Code != http.StatusConflict {
		t.Fatalf("changed receive retry: %d %s", w.Code, w.Body.String())
	}
	if w := request(a, "POST", path, map[string]any{"action": "receive", "batchId": batchID, "quantity": 1, "idempotencyKey": "fg-duplicate-receive-0001"}, admin...); w.Code != http.StatusConflict {
		t.Fatalf("duplicate receive: %d %s", w.Code, w.Body.String())
	}
	var onHand, receipts, checks int
	if err := a.db.QueryRow("SELECT quantity_on_hand FROM mes_finished_goods_inventory WHERE organization_id=? AND batch_id=?", org, batchID).Scan(&onHand); err != nil {
		t.Fatalf("inventory ledger missing: %v", err)
	}
	a.db.QueryRow("SELECT count(*) FROM mes_finished_goods_receipts WHERE organization_id=? AND batch_id=?", org, batchID).Scan(&receipts)
	a.db.QueryRow("SELECT count(*) FROM mes_finished_goods_quality_dispositions WHERE organization_id=? AND batch_id=?", org, batchID).Scan(&checks)
	if onHand != target || receipts != 1 || checks != 3 {
		t.Fatalf("inventory=%d receipts=%d dispositions=%d", onHand, receipts, checks)
	}

	closeInput := map[string]any{"action": "close", "workOrderId": wo, "idempotencyKey": "fg-happy-close-0001"}
	if w := request(a, "POST", path, closeInput, other...); w.Code != http.StatusNotFound {
		t.Fatalf("foreign close: %d %s", w.Code, w.Body.String())
	}
	if w := request(a, "POST", path, closeInput, readonly...); w.Code != http.StatusForbidden {
		t.Fatalf("readonly close: %d %s", w.Code, w.Body.String())
	}
	closed := request(a, "POST", path, closeInput, admin...)
	if closed.Code != http.StatusOK {
		t.Fatalf("close: %d %s", closed.Code, closed.Body.String())
	}
	if w := request(a, "POST", path, closeInput, admin...); w.Code != http.StatusOK {
		t.Fatalf("close replay: %d %s", w.Code, w.Body.String())
	}
	var status string
	if err := a.db.QueryRow("SELECT status FROM mes_work_orders WHERE organization_id=? AND id=?", org, wo).Scan(&status); err != nil || status != "closed" {
		t.Fatalf("status=%q error=%v", status, err)
	}
	if w := request(a, "POST", path, map[string]any{"action": "receive", "batchId": batchID, "quantity": 1, "idempotencyKey": "fg-after-close-0001"}, admin...); w.Code != http.StatusConflict {
		t.Fatalf("received after close: %d %s", w.Code, w.Body.String())
	}
}

func TestMESFinishedGoodsConcurrentReceiptAndHistoricalCompletedOrder(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	admin := loginSite(t, a, "admin@suite.test", space, "mes")
	operator := loginSite(t, a, "front@suite.test", space, "mes")
	var wo, op string
	var target int
	if err := a.db.QueryRow("SELECT id,target_quantity FROM mes_work_orders WHERE organization_id=? AND status='released' AND materials_staged=1 LIMIT 1", org).Scan(&wo, &target); err != nil {
		t.Fatal(err)
	}
	if err := a.db.QueryRow("SELECT id FROM mes_operations WHERE organization_id=? AND work_order_id=? LIMIT 1", org, wo).Scan(&op); err != nil {
		t.Fatal(err)
	}
	if _, err := a.db.Exec("UPDATE mes_work_orders SET status='completed',completed_quantity=target_quantity WHERE organization_id=? AND id=?", org, wo); err != nil {
		t.Fatal(err)
	}
	closeInput := map[string]any{"action": "close", "workOrderId": wo, "idempotencyKey": "fg-historical-close-0001"}
	if w := request(a, "POST", "/api/stations/mes/finished-goods", closeInput, admin...); w.Code != http.StatusConflict {
		t.Fatalf("legacy completed order auto-closed: %d %s", w.Code, w.Body.String())
	}

	// Reinitialize another fresh order via a unique organization fixture is not
	// available here; make the current completed order's traceable report and
	// batch setup explicit, then race the one-time receipt command.
	_, err := a.db.Exec("INSERT INTO mes_production_reports(id,organization_id,work_order_id,operation_id,operator_id,good_quantity,scrap_quantity,idempotency_key) VALUES(?,?,?,?,?, ?,0,?)", "fg_report_"+space, org, wo, op, "test-operator", target, "fg-race-report-0001")
	if err != nil {
		t.Fatal(err)
	}
	// The API intentionally rejects batches inferred from historical work; the
	// report created after completion is still subject to explicit batch checks.
	reportID := "fg_report_" + space
	path := "/api/stations/mes/finished-goods"
	create := map[string]any{"action": "createBatch", "workOrderId": wo, "reportId": reportID, "batchNumber": "FG-RACE-" + space, "quantity": target, "idempotencyKey": "fg-race-create-0001"}
	created := request(a, "POST", path, create, admin...)
	if created.Code != http.StatusOK {
		t.Fatalf("historical explicit batch creation: %d %s", created.Code, created.Body.String())
	}
	var parsed struct {
		Data struct {
			BatchID string `json:"batchId"`
		} `json:"data"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &parsed); err != nil || parsed.Data.BatchID == "" {
		t.Fatalf("batch parse: %v %s", err, created.Body.String())
	}
	batchID := parsed.Data.BatchID
	passedCheck := "fg-race-check-" + space
	if _, err := a.db.Exec("INSERT INTO mes_quality_checks(id,organization_id,work_order_id,report_id,inspector_id,sample_quantity,passed_quantity,failed_quantity,status,disposition) VALUES(?,?,?,?,?,1,1,0,'passed','release')", passedCheck, org, wo, reportID, org+"_admin"); err != nil {
		t.Fatal(err)
	}
	qc := map[string]any{"action": "qualityDisposition", "batchId": batchID, "qualityCheckId": passedCheck, "passedQuantity": target, "failedQuantity": 0, "disposition": "release", "idempotencyKey": "fg-race-qc-0001"}
	if w := request(a, "POST", path, qc, admin...); w.Code != http.StatusOK {
		t.Fatalf("release: %d %s", w.Code, w.Body.String())
	}
	var wg sync.WaitGroup
	statuses := make(chan int, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			input := map[string]any{"action": "receive", "batchId": batchID, "quantity": target, "idempotencyKey": fmt.Sprintf("fg-race-receive-%08d", i)}
			statuses <- request(a, "POST", path, input, admin...).Code
		}(i)
	}
	wg.Wait()
	close(statuses)
	success, conflicts := 0, 0
	for code := range statuses {
		if code == http.StatusOK {
			success++
		} else if code == http.StatusConflict {
			conflicts++
		} else {
			t.Errorf("unexpected receipt status %d", code)
		}
	}
	if success != 1 || conflicts != 11 {
		t.Fatalf("receipt race success=%d conflicts=%d", success, conflicts)
	}
	var count int
	if err := a.db.QueryRow("SELECT count(*) FROM mes_finished_goods_receipts WHERE organization_id=? AND batch_id=?", org, batchID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("receipt ledger count=%d err=%v", count, err)
	}
	_ = operator
}
