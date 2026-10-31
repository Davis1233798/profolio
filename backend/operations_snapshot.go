package main

import "net/http"

// operationsSnapshot reads operational records, never the isolated traffic lab.
func (a *App) operationsSnapshot(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant, site string) {
	if r.Method != http.MethodGet {
		fail(w, 405, "Use GET")
		return
	}
	if g.Scope != "back" {
		fail(w, 403, "Back-office access required")
		return
	}
	query := ""
	if site == "shop" {
		query = `SELECT (SELECT COUNT(*) FROM shop_orders WHERE organization_id=? AND payment_status='pending'), (SELECT COUNT(*) FROM shop_orders WHERE organization_id=? AND payment_status='paid' AND fulfillment_status='unfulfilled'), (SELECT COUNT(*) FROM outbox_events WHERE organization_id=? AND event_type='shop.paid' AND status='pending'), (SELECT COUNT(*) FROM outbox_events WHERE organization_id=? AND event_type='shop.paid' AND status='pending' AND retry_count>0)`
	} else {
		query = `SELECT (SELECT COUNT(*) FROM mes_work_orders WHERE organization_id=? AND status='in_progress'), (SELECT COUNT(*) FROM mes_work_orders WHERE organization_id=? AND status IN ('draft','released')), (SELECT COUNT(*) FROM mes_production_reports WHERE organization_id=?), (SELECT COUNT(*) FROM mes_downtime_events WHERE organization_id=? AND end_time IS NULL)`
	}
	var first, second, third, fourth int64
	if e := a.db.QueryRow(query, id.OrganizationID, id.OrganizationID, id.OrganizationID, id.OrganizationID).Scan(&first, &second, &third, &fourth); e != nil {
		fail(w, 503, "Cannot read operational snapshot")
		return
	}
	if site == "shop" {
		ok(w, map[string]any{"pendingPayment": first, "paidUnfulfilled": second, "pendingOutbox": third, "retryingOutbox": fourth})
	} else {
		ok(w, map[string]any{"runningOrders": first, "waitingOrders": second, "productionReports": third, "openDowntime": fourth})
	}
}
