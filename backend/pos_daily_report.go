package main

import (
	"database/sql"
	"errors"
	"net/http"
	"time"
)

// Sales and refunds are attributed to their own local calendar date in Taipei.
func (a *App) posDailyReport(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant) {
	if r.Method != http.MethodGet {
		fail(w, 405, "Use GET")
		return
	}
	if g.Scope != "back" {
		fail(w, 403, "Back-office access required")
		return
	}
	store, date := r.URL.Query().Get("storeId"), r.URL.Query().Get("date")
	if len(store) == 0 || len(store) > 256 {
		fail(w, 400, "Select a store")
		return
	}
	zone := time.FixedZone("Asia/Taipei", 8*3600)
	if date == "" {
		date = time.Now().In(zone).Format("2006-01-02")
	}
	day, e := time.ParseInLocation("2006-01-02", date, zone)
	if e != nil || day.Format("2006-01-02") != date {
		fail(w, 400, "Enter a valid date")
		return
	}
	start, end := day.UTC().Format(time.RFC3339), day.AddDate(0, 0, 1).UTC().Format(time.RFC3339)
	tx, e := a.db.BeginTx(r.Context(), &sql.TxOptions{ReadOnly: true})
	if e != nil {
		fail(w, 503, "Report unavailable")
		return
	}
	defer tx.Rollback()
	var exists int
	e = tx.QueryRow("SELECT count(*) FROM pos_stores WHERE organization_id=? AND id=?", id.OrganizationID, store).Scan(&exists)
	if errors.Is(e, sql.ErrNoRows) || e == nil && exists == 0 {
		fail(w, 404, "Store not found")
		return
	}
	if e != nil {
		fail(w, 503, "Cannot read store")
		return
	}
	var gross, refunds, salesCount, refundCount int64
	e = tx.QueryRow("SELECT COALESCE(SUM(total_amount),0),COUNT(*) FROM pos_sales WHERE organization_id=? AND store_id=? AND status='completed' AND julianday(created_at)>=julianday(?) AND julianday(created_at)<julianday(?)", id.OrganizationID, store, start, end).Scan(&gross, &salesCount)
	if e == nil {
		e = tx.QueryRow("SELECT COALESCE(SUM(r.refund_amount),0),COUNT(*) FROM pos_refunds r JOIN pos_sales s ON s.id=r.original_sale_id AND s.organization_id=r.organization_id WHERE r.organization_id=? AND s.store_id=? AND julianday(r.created_at)>=julianday(?) AND julianday(r.created_at)<julianday(?)", id.OrganizationID, store, start, end).Scan(&refunds, &refundCount)
	}
	if e != nil {
		fail(w, 503, "Cannot calculate daily report")
		return
	}
	if e = tx.Commit(); e != nil {
		fail(w, 503, "Cannot complete daily report")
		return
	}
	ok(w, map[string]any{"date": date, "storeId": store, "grossSales": gross, "totalRefunds": refunds, "netSales": gross - refunds, "transactionCount": salesCount, "refundCount": refundCount})
}
