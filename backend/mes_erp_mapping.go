package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
)

type mesERPMappingRequest struct {
	Action      string `json:"action"`
	ProductID   string `json:"mesProductId"`
	ItemID      string `json:"erpItemId"`
	WarehouseID string `json:"warehouseId"`
	Key         string `json:"idempotencyKey"`
}

func (a *App) mesERPMapping(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Use POST")
		return
	}
	if g.Role != "admin" || g.Scope != "back" {
		fail(w, 403, "Back-office administrator required")
		return
	}
	var in mesERPMappingRequest
	if body(r, &in) != nil || in.Action != "mapProduct" || len(in.Key) < 8 || len(in.Key) > 128 || len(in.ProductID) < 1 || len(in.ProductID) > 256 || len(in.ItemID) < 1 || len(in.ItemID) > 256 || len(in.WarehouseID) < 1 || len(in.WarehouseID) > 256 {
		fail(w, 400, "Invalid product mapping")
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		fail(w, 503, "Mapping unavailable")
		return
	}
	defer tx.Rollback()
	for _, site := range []string{"mes", "erp"} {
		var n int
		err = tx.QueryRow(`SELECT count(*) FROM station_accounts a JOIN station_grants g ON g.user_id=a.user_id WHERE a.organization_id=? AND a.user_id=? AND a.disabled=0 AND g.site=? AND g.enabled=1 AND g.scope='back' AND g.role='admin'`, id.OrganizationID, id.UserID, site).Scan(&n)
		if err != nil {
			fail(w, 503, "Cannot verify permissions")
			return
		}
		if n != 1 {
			fail(w, 403, "MES and ERP administrator access required")
			return
		}
	}
	raw, _ := json.Marshal(in)
	requestHash := digest(id.UserID + "\x00" + string(raw))
	const endpoint = "/station/erp/mes-integration/mapProduct"
	var oldHash, oldBody string
	err = tx.QueryRow("SELECT request_hash,response_body FROM idempotency_keys WHERE organization_id=? AND key=? AND endpoint=?", id.OrganizationID, in.Key, endpoint).Scan(&oldHash, &oldBody)
	if err == nil {
		if oldHash != requestHash {
			fail(w, 409, "Retry key already used")
			return
		}
		var result map[string]any
		if json.Unmarshal([]byte(oldBody), &result) != nil {
			fail(w, 500, "Invalid stored result")
			return
		}
		ok(w, result)
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		fail(w, 503, "Cannot inspect retry state")
		return
	}
	var count int
	err = tx.QueryRow(`SELECT count(*) FROM mes_products p JOIN erp_items i ON i.organization_id=p.organization_id AND i.id=? AND i.is_active=1 JOIN erp_warehouses w ON w.organization_id=p.organization_id AND w.id=? AND w.is_active=1 WHERE p.organization_id=? AND p.id=? AND p.status='active' AND p.unit=i.unit`, in.ItemID, in.WarehouseID, id.OrganizationID, in.ProductID).Scan(&count)
	if err != nil {
		fail(w, 503, "Cannot verify mapping")
		return
	}
	if count != 1 {
		fail(w, 409, "Active product, item, warehouse and matching units required")
		return
	}
	var version int
	err = tx.QueryRow("SELECT COALESCE(MAX(version),0)+1 FROM mes_erp_product_mappings WHERE organization_id=? AND mes_product_id=?", id.OrganizationID, in.ProductID).Scan(&version)
	if err == nil {
		_, err = tx.Exec("UPDATE mes_erp_product_mappings SET is_active=0 WHERE organization_id=? AND mes_product_id=? AND is_active=1", id.OrganizationID, in.ProductID)
	}
	mappingID := "mesmap_" + token()
	if err == nil {
		_, err = tx.Exec("INSERT INTO mes_erp_product_mappings(id,organization_id,mes_product_id,erp_item_id,warehouse_id,version,is_active) VALUES(?,?,?,?,?,?,1)", mappingID, id.OrganizationID, in.ProductID, in.ItemID, in.WarehouseID, version)
	}
	result := map[string]any{"mappingId": mappingID, "version": version}
	encoded, _ := json.Marshal(result)
	if err == nil {
		_, err = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", "idem_"+token(), id.OrganizationID, in.Key, endpoint, requestHash, string(encoded))
	}
	if err == nil {
		_, err = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,after_value) VALUES(?,?,?,?,?,'mes_erp_mapping',?,?)", "audit_"+token(), id.OrganizationID, id.UserID, g.Role, "erp.mes.mapProduct", mappingID, string(encoded))
	}
	if err != nil {
		fail(w, 409, "Cannot apply mapping; retry if the mapping changed")
		return
	}
	if err = tx.Commit(); err != nil {
		fail(w, 503, "Mapping transaction failed")
		return
	}
	ok(w, result)
}
