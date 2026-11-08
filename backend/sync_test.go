package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func newSyncTestApp(t *testing.T) (*App, func()) {
	dbPath := filepath.Join(t.TempDir(), "sync_test.sqlite")
	db, err := openDB(dbPath)
	if err != nil {
		t.Fatalf("Failed to open test database: %v", err)
	}
	app := &App{db: db, assets: "."}
	return app, func() {
		_ = db.Close()
	}
}

func TestSync_TransactionalOutbox(t *testing.T) {
	app, cleanup := newSyncTestApp(t)
	defer cleanup()

	org := "org_test_sync_01"
	tx, err := app.db.Begin()
	if err != nil {
		t.Fatalf("failed to begin tx: %v", err)
	}

	payload := map[string]any{
		"orderNo":  "WO-2026-001",
		"quantity": 500,
		"status":   "running",
	}

	syncID, err := RecordSyncChange(tx, org, "mes.work_order", "wo-001", "INSERT", payload)
	if err != nil {
		t.Fatalf("RecordSyncChange failed: %v", err)
	}
	if syncID == "" {
		t.Fatalf("expected non-empty sync ID")
	}

	if err := tx.Commit(); err != nil {
		t.Fatalf("failed to commit: %v", err)
	}

	// Verify outbox entry
	var status, entityType, idempKey string
	err = app.db.QueryRow("SELECT status, entity_type, idempotency_key FROM sync_outbox WHERE id = ?", syncID).Scan(&status, &entityType, &idempKey)
	if err != nil {
		t.Fatalf("failed to query sync_outbox: %v", err)
	}

	if status != "pending" {
		t.Errorf("expected status 'pending', got '%s'", status)
	}
	if entityType != "mes.work_order" {
		t.Errorf("expected entity_type 'mes.work_order', got '%s'", entityType)
	}
	if len(idempKey) != 64 {
		t.Errorf("expected 64-char sha256 idempotency key, got len %d", len(idempKey))
	}
}

func TestSync_PushAndAckRoundtrip(t *testing.T) {
	app, cleanup := newSyncTestApp(t)
	defer cleanup()

	org := "org_test_sync_02"

	// Record 3 changes
	for i := 1; i <= 3; i++ {
		tx, err := app.db.Begin()
		if err != nil {
			t.Fatalf("tx begin failed: %v", err)
		}
		_, err = RecordSyncChange(tx, org, "erp.stock_transfer", "tr-00"+string(rune('0'+i)), "INSERT", map[string]any{"seq": i})
		if err != nil {
			t.Fatalf("record change %d failed: %v", i, err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatalf("commit %d failed: %v", i, err)
		}
	}

	// Push batch
	items, err := GeneratePushBatch(app.db, org, 10)
	if err != nil {
		t.Fatalf("GeneratePushBatch failed: %v", err)
	}
	if len(items) != 3 {
		t.Fatalf("expected 3 items, got %d", len(items))
	}

	// Verify marked in_flight
	var inFlightCount int
	_ = app.db.QueryRow("SELECT COUNT(*) FROM sync_outbox WHERE organization_id = ? AND status = 'in_flight'", org).Scan(&inFlightCount)
	if inFlightCount != 3 {
		t.Errorf("expected 3 in_flight items, got %d", inFlightCount)
	}

	// Acknowledge
	var ids []string
	for _, it := range items {
		ids = append(ids, it.ID)
	}
	if err := AcknowledgePushBatch(app.db, org, ids); err != nil {
		t.Fatalf("AcknowledgePushBatch failed: %v", err)
	}

	// Check status
	stats, err := GetSyncStatus(app.db, org)
	if err != nil {
		t.Fatalf("GetSyncStatus failed: %v", err)
	}

	if stats["pendingOutbox"] != 0 {
		t.Errorf("expected 0 pending outbox, got %v", stats["pendingOutbox"])
	}
	if stats["syncedCount"] != 3 {
		t.Errorf("expected 3 synced items, got %v", stats["syncedCount"])
	}
}

func TestSync_IdempotentDeduplication(t *testing.T) {
	app, cleanup := newSyncTestApp(t)
	defer cleanup()

	org := "org_test_sync_03"

	batch := []SyncChangeItem{
		{
			ID:             "remote_01",
			OrganizationID: org,
			EntityType:     "crm.customer",
			EntityID:       "cust-999",
			Operation:      "INSERT",
			Payload:        `{"name":"Acme Corp","tier":"vip"}`,
			IdempotencyKey: "idemp_test_key_001_unique_hash",
		},
	}

	// First ingestion
	ingested, deduplicated, conflicts, err := IngestRemoteBatch(app.db, org, batch)
	if err != nil {
		t.Fatalf("first ingestion failed: %v", err)
	}
	if ingested != 1 || deduplicated != 0 || conflicts != 0 {
		t.Errorf("expected (1, 0, 0), got (%d, %d, %d)", ingested, deduplicated, conflicts)
	}

	// Replay identical batch (simulate network retry)
	ingested2, deduplicated2, conflicts2, err := IngestRemoteBatch(app.db, org, batch)
	if err != nil {
		t.Fatalf("second ingestion failed: %v", err)
	}
	if ingested2 != 0 || deduplicated2 != 1 || conflicts2 != 0 {
		t.Errorf("expected (0, 1, 0) on replay, got (%d, %d, %d)", ingested2, deduplicated2, conflicts2)
	}
}

func TestSync_DeltaMergeNumerical(t *testing.T) {
	app, cleanup := newSyncTestApp(t)
	defer cleanup()

	org := "org_test_sync_04"

	deltaBatch := []SyncChangeItem{
		{
			ID:             "delta_01",
			OrganizationID: org,
			EntityType:     "erp.inventory_delta",
			EntityID:       "sku-metal-rod-01",
			Operation:      "DELTA",
			Payload:        `{"quantityDelta": -5, "warehouse": "WH-MAIN"}`,
			IdempotencyKey: "idemp_delta_key_001",
		},
		{
			ID:             "delta_02",
			OrganizationID: org,
			EntityType:     "erp.inventory_delta",
			EntityID:       "sku-metal-rod-01",
			Operation:      "DELTA",
			Payload:        `{"quantityDelta": 10, "warehouse": "WH-MAIN"}`,
			IdempotencyKey: "idemp_delta_key_002",
		},
	}

	ingested, _, conflicts, err := IngestRemoteBatch(app.db, org, deltaBatch)
	if err != nil {
		t.Fatalf("delta ingestion failed: %v", err)
	}
	if ingested != 2 || conflicts != 0 {
		t.Errorf("expected (2 ingested, 0 conflicts), got (%d, %d)", ingested, conflicts)
	}
}

func TestSync_ConflictDetectionAndQuarantine(t *testing.T) {
	app, cleanup := newSyncTestApp(t)
	defer cleanup()

	org := "org_test_sync_05"

	// 1. Edge has a local pending change on order "ord-777"
	tx, err := app.db.Begin()
	if err != nil {
		t.Fatalf("tx begin failed: %v", err)
	}
	_, err = RecordSyncChange(tx, org, "shop.order", "ord-777", "UPDATE", map[string]any{
		"shippingAddress": "Taipei City, Station Road 10",
		"status":          "processing",
	})
	if err != nil {
		t.Fatalf("RecordSyncChange failed: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("tx commit failed: %v", err)
	}

	// 2. Remote arrives with a concurrent UPDATE for the same entity "ord-777"
	remoteBatch := []SyncChangeItem{
		{
			ID:             "rem_ord_777",
			OrganizationID: org,
			EntityType:     "shop.order",
			EntityID:       "ord-777",
			Operation:      "UPDATE",
			Payload:        `{"shippingAddress": "Hsinchu Science Park 22", "status": "processing"}`,
			IdempotencyKey: "idemp_remote_ord_777_hash",
		},
	}

	ingested, deduplicated, conflicts, err := IngestRemoteBatch(app.db, org, remoteBatch)
	if err != nil {
		t.Fatalf("ingestion failed: %v", err)
	}

	if conflicts != 1 {
		t.Fatalf("expected 1 conflict, got %d (ingested=%d, dedup=%d)", conflicts, ingested, deduplicated)
	}

	// Verify quarantine record
	var reason, resStatus, localP, remoteP string
	err = app.db.QueryRow(
		"SELECT conflict_reason, resolution_status, local_payload, remote_payload FROM sync_conflicts WHERE organization_id = ? AND entity_id = ?",
		org, "ord-777",
	).Scan(&reason, &resStatus, &localP, &remoteP)
	if err != nil {
		t.Fatalf("failed to query sync_conflicts: %v", err)
	}

	if reason != "concurrent_field_divergence" {
		t.Errorf("expected conflict_reason 'concurrent_field_divergence', got '%s'", reason)
	}
	if resStatus != "pending_review" {
		t.Errorf("expected resolution_status 'pending_review', got '%s'", resStatus)
	}
}

func TestSync_HTTPAPI_Endpoints(t *testing.T) {
	app, cleanup := newSyncTestApp(t)
	defer cleanup()

	// 1. GET /api/sync/status
	req := httptest.NewRequest("GET", "/api/sync/status", nil)
	w := httptest.NewRecorder()
	app.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/sync/status failed: %d, body: %s", w.Code, w.Body.String())
	}

	var statusResp struct {
		Success bool           `json:"success"`
		Data    map[string]any `json:"data"`
	}
	if err := json.NewDecoder(w.Body).Decode(&statusResp); err != nil {
		t.Fatalf("decode status response failed: %v", err)
	}
	if !statusResp.Success || statusResp.Data["syncMode"] != "hybrid_active" {
		t.Errorf("expected hybrid_active mode, got %v", statusResp.Data["syncMode"])
	}

	// 2. POST /api/sync/ingest
	ingestPayload := map[string]any{
		"items": []SyncChangeItem{
			{
				ID:             "item_http_01",
				OrganizationID: "org_test_default",
				EntityType:     "pos.receipt",
				EntityID:       "rcpt-1001",
				Operation:      "INSERT",
				Payload:        `{"total": 1280}`,
				IdempotencyKey: "idemp_http_rcpt_001",
			},
		},
	}
	ingestBytes, _ := json.Marshal(ingestPayload)
	req2 := httptest.NewRequest("POST", "/api/sync/ingest", bytes.NewReader(ingestBytes))
	req2.Header.Set("Content-Type", "application/json")
	w2 := httptest.NewRecorder()
	app.ServeHTTP(w2, req2)

	if w2.Code != http.StatusOK {
		t.Fatalf("POST /api/sync/ingest failed: %d, body: %s", w2.Code, w2.Body.String())
	}

	// 3. GET /api/sync/conflicts
	req3 := httptest.NewRequest("GET", "/api/sync/conflicts", nil)
	w3 := httptest.NewRecorder()
	app.ServeHTTP(w3, req3)

	if w3.Code != http.StatusOK {
		t.Fatalf("GET /api/sync/conflicts failed: %d, body: %s", w3.Code, w3.Body.String())
	}
}
