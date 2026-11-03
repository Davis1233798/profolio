package main

import "net/http"

func (a *App) mesERPWorkspace(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant) {
	if g.Role != "admin" || g.Scope != "back" {
		fail(w, 403, "Back-office administrator required")
		return
	}
	for _, site := range []string{"mes", "erp"} {
		var n int
		err := a.db.QueryRowContext(r.Context(), `SELECT count(*) FROM station_accounts a JOIN station_grants g ON g.user_id=a.user_id WHERE a.organization_id=? AND a.user_id=? AND a.disabled=0 AND g.site=? AND g.enabled=1 AND g.scope='back' AND g.role='admin'`, id.OrganizationID, id.UserID, site).Scan(&n)
		if err != nil {
			fail(w, 503, "Cannot verify permissions")
			return
		}
		if n != 1 {
			fail(w, 403, "MES and ERP administrator access required")
			return
		}
	}
	queries := map[string]string{
		"products":   "SELECT id,sku,name,unit,status FROM mes_products WHERE organization_id=? ORDER BY id LIMIT 500",
		"items":      "SELECT id,sku,name,unit,is_active FROM erp_items WHERE organization_id=? ORDER BY id LIMIT 500",
		"warehouses": "SELECT id,name,code,is_active FROM erp_warehouses WHERE organization_id=? ORDER BY id LIMIT 500",
		"mappings":   "SELECT id,mes_product_id,erp_item_id,warehouse_id,version,is_active FROM mes_erp_product_mappings WHERE organization_id=? ORDER BY rowid DESC LIMIT 500",
		"events":     `SELECT id,status,json_extract(payload,'$.eventId') AS event_id,json_extract(payload,'$.sourceReceiptId') AS source_receipt_id,json_extract(payload,'$.batchId') AS batch_id,json_extract(payload,'$.mesProductId') AS mes_product_id,json_extract(payload,'$.quantity') AS quantity,json_extract(payload,'$.occurredAt') AS occurred_at FROM outbox_events WHERE organization_id=? AND event_type='mes.finished_goods.received' ORDER BY rowid DESC LIMIT 500`,
	}
	result := map[string]any{}
	for key, query := range queries {
		rows, err := queryMaps(a.db, query, id.OrganizationID)
		if err != nil {
			fail(w, 503, "Cannot load integration workspace")
			return
		}
		result[key] = rows
	}
	ok(w, result)
}
