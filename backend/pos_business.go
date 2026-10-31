package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type posCommand struct {
	Action         string `json:"action"`
	RegisterID     string `json:"registerId"`
	ShiftID        string `json:"shiftId"`
	ItemID         string `json:"itemId"`
	SaleLineID     string `json:"saleLineId"`
	Reason         string `json:"reason"`
	Quantity       int    `json:"quantity"`
	OpeningCash    int64  `json:"openingCash"`
	ClosingCash    int64  `json:"closingCash"`
	Tender         int64  `json:"tender"`
	IdempotencyKey string `json:"idempotencyKey"`
}

func (a *App) posBusiness(w http.ResponseWriter, r *http.Request, id *Identity, grant *Grant) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Use POST")
		return
	}
	if grant.Role == "readonly" {
		fail(w, 403, "A write-enabled role is required")
		return
	}
	var in posCommand
	if body(r, &in) != nil || len(in.IdempotencyKey) < 8 || len(in.IdempotencyKey) > 128 || len(in.RegisterID) > 256 || len(in.ShiftID) > 256 || len(in.ItemID) > 256 || len(in.SaleLineID) > 256 || len(in.Reason) > 200 {
		fail(w, 400, "Invalid point-of-sale request")
		return
	}
	if in.Action != "open" && in.Action != "checkout" && in.Action != "close" && in.Action != "refund" {
		fail(w, 400, "Unknown point-of-sale action")
		return
	}
	if in.Action == "refund" && (grant.Role != "admin" || grant.Scope != "back") {
		fail(w, 403, "Refunds require a back-office administrator")
		return
	}
	if in.Action == "refund" && (in.SaleLineID == "" || in.Quantity < 1 || in.Quantity > 1000 || strings.TrimSpace(in.Reason) == "") {
		fail(w, 400, "Select a sale line, quantity and reason")
		return
	}
	if in.OpeningCash < 0 || in.ClosingCash < 0 || in.Tender < 0 || in.OpeningCash > 1000000000 || in.ClosingCash > 1000000000 || in.Tender > 1000000000 {
		fail(w, 400, "Invalid cash amount")
		return
	}
	if in.Action == "checkout" && (in.ItemID == "" || in.ShiftID == "" || in.Quantity < 1 || in.Quantity > 1000) {
		fail(w, 400, "Select a shift, product and valid quantity")
		return
	}
	if in.Action == "open" && in.RegisterID == "" || in.Action == "close" && in.ShiftID == "" {
		fail(w, 400, "Register or shift is required")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, 503, "Point-of-sale service unavailable")
		return
	}
	defer tx.Rollback()
	endpoint := "/station/pos/" + in.Action
	raw, _ := json.Marshal(in)
	fingerprint := digest(id.UserID + "\x00" + string(raw))
	var priorHash, priorBody string
	e = tx.QueryRow("SELECT request_hash,response_body FROM idempotency_keys WHERE organization_id=? AND key=? AND endpoint=?", id.OrganizationID, in.IdempotencyKey, endpoint).Scan(&priorHash, &priorBody)
	if e == nil {
		if priorHash != fingerprint {
			fail(w, 409, "Retry key was used for a different request")
			return
		}
		var result map[string]any
		if json.Unmarshal([]byte(priorBody), &result) != nil {
			fail(w, 500, "Invalid stored result")
			return
		}
		ok(w, result)
		return
	}
	if !errors.Is(e, sql.ErrNoRows) {
		fail(w, 503, "Cannot read retry state")
		return
	}
	result := map[string]any{}
	entityID := ""
	switch in.Action {
	case "open":
		var store string
		e = tx.QueryRow("SELECT store_id FROM pos_registers WHERE id=? AND organization_id=? AND is_active=1", in.RegisterID, id.OrganizationID).Scan(&store)
		if errors.Is(e, sql.ErrNoRows) {
			fail(w, 404, "Active register not found")
			return
		}
		if e != nil {
			fail(w, 503, "Cannot read register")
			return
		}
		var open int
		if e = tx.QueryRow("SELECT count(*) FROM pos_shifts WHERE organization_id=? AND register_id=? AND status='open'", id.OrganizationID, in.RegisterID).Scan(&open); e != nil {
			fail(w, 503, "Cannot read shift")
			return
		}
		if open != 0 {
			fail(w, 409, "Register already has an open shift")
			return
		}
		entityID = "shift_" + token()
		if _, e = tx.Exec("INSERT INTO pos_shifts(id,organization_id,store_id,register_id,cashier_id,opening_cash,status) VALUES(?,?,?,?,?,?,'open')", entityID, id.OrganizationID, store, in.RegisterID, id.UserID, in.OpeningCash); e != nil {
			fail(w, 503, "Could not open shift")
			return
		}
		result = map[string]any{"shiftId": entityID, "status": "open"}
	case "checkout":
		var store, register, cashier, status string
		e = tx.QueryRow("SELECT store_id,register_id,cashier_id,status FROM pos_shifts WHERE id=? AND organization_id=?", in.ShiftID, id.OrganizationID).Scan(&store, &register, &cashier, &status)
		if errors.Is(e, sql.ErrNoRows) {
			fail(w, 404, "Shift not found")
			return
		}
		if e != nil {
			fail(w, 503, "Cannot read shift")
			return
		}
		if status != "open" {
			fail(w, 409, "Shift is not open")
			return
		}
		if cashier != id.UserID && grant.Role != "admin" {
			fail(w, 403, "Cannot use another cashier's shift")
			return
		}
		var barcode, name string
		var price, stock int64
		e = tx.QueryRow("SELECT barcode,name,price,stock_quantity FROM pos_catalog_items WHERE id=? AND organization_id=? AND is_active=1", in.ItemID, id.OrganizationID).Scan(&barcode, &name, &price, &stock)
		if errors.Is(e, sql.ErrNoRows) {
			fail(w, 404, "Active product not found")
			return
		}
		if e != nil {
			fail(w, 503, "Cannot read product")
			return
		}
		if price < 0 || price > 1000000 || stock < int64(in.Quantity) {
			fail(w, 409, "Insufficient stock")
			return
		}
		total := price * int64(in.Quantity)
		if in.Tender < total {
			fail(w, 400, "Cash tender is less than the total")
			return
		}
		update, err := tx.Exec("UPDATE pos_catalog_items SET stock_quantity=stock_quantity-? WHERE id=? AND organization_id=? AND stock_quantity>=?", in.Quantity, in.ItemID, id.OrganizationID, in.Quantity)
		if err != nil {
			fail(w, 503, "Stock update failed")
			return
		}
		n, err := update.RowsAffected()
		if err != nil || n != 1 {
			fail(w, 409, "Stock changed; refresh and retry")
			return
		}
		entityID = "sale_" + token()
		receipt := "POS-" + strings.ToUpper(token()[:12])
		change := in.Tender - total
		_, e = tx.Exec("INSERT INTO pos_sales(id,organization_id,receipt_number,store_id,register_id,shift_id,cashier_id,subtotal,total_amount,tender_amount,change_amount,payment_method,status,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,'cash','completed',?)", entityID, id.OrganizationID, receipt, store, register, in.ShiftID, id.UserID, total, total, in.Tender, change, in.IdempotencyKey)
		if e != nil {
			fail(w, 503, "Could not save sale")
			return
		}
		_, e = tx.Exec("INSERT INTO pos_sale_lines(id,organization_id,sale_id,item_id,barcode,name,unit_price,quantity,line_total) VALUES(?,?,?,?,?,?,?,?,?)", "sale_line_"+token(), id.OrganizationID, entityID, in.ItemID, barcode, name, price, in.Quantity, total)
		if e != nil {
			fail(w, 503, "Could not save sale line")
			return
		}
		result = map[string]any{"saleId": entityID, "receiptNumber": receipt, "totalAmount": total, "changeAmount": change}
	case "refund":
		var saleID, itemID, shiftStatus, saleStatus string
		var sold, refunded int
		var lineTotal int64
		e = tx.QueryRow(`SELECT l.sale_id,l.item_id,l.quantity,l.refunded_quantity,l.line_total,s.status,sh.status FROM pos_sale_lines l JOIN pos_sales s ON s.id=l.sale_id AND s.organization_id=l.organization_id JOIN pos_shifts sh ON sh.id=s.shift_id AND sh.organization_id=s.organization_id WHERE l.id=? AND l.organization_id=?`, in.SaleLineID, id.OrganizationID).Scan(&saleID, &itemID, &sold, &refunded, &lineTotal, &saleStatus, &shiftStatus)
		if errors.Is(e, sql.ErrNoRows) {
			fail(w, 404, "Sale line not found")
			return
		}
		if e != nil {
			fail(w, 503, "Cannot read sale line")
			return
		}
		if saleStatus != "completed" || shiftStatus != "open" || sold < 1 || sold > 1000000 || refunded < 0 || in.Quantity > sold-refunded || lineTotal < 0 || lineTotal > 1000000000 {
			fail(w, 409, "Refund exceeds the remaining quantity or the original shift is closed")
			return
		}
		amount := lineTotal*int64(refunded+in.Quantity)/int64(sold) - lineTotal*int64(refunded)/int64(sold)
		update, err := tx.Exec("UPDATE pos_sale_lines SET refunded_quantity=refunded_quantity+? WHERE id=? AND organization_id=? AND refunded_quantity+?<=quantity", in.Quantity, in.SaleLineID, id.OrganizationID, in.Quantity)
		if err != nil {
			fail(w, 503, "Could not update refund quantity")
			return
		}
		n, err := update.RowsAffected()
		if err != nil || n != 1 {
			fail(w, 409, "Refund quantity changed; retry")
			return
		}
		update, err = tx.Exec("UPDATE pos_catalog_items SET stock_quantity=stock_quantity+? WHERE id=? AND organization_id=?", in.Quantity, itemID, id.OrganizationID)
		if err != nil {
			fail(w, 503, "Could not restore stock")
			return
		}
		n, err = update.RowsAffected()
		if err != nil || n != 1 {
			fail(w, 409, "Original product no longer exists")
			return
		}
		entityID = "refund_" + token()
		number := "REF-" + strings.ToUpper(token()[:12])
		if _, e = tx.Exec("INSERT INTO pos_refunds(id,organization_id,refund_number,original_sale_id,manager_id,reason,refund_amount) VALUES(?,?,?,?,?,?,?)", entityID, id.OrganizationID, number, saleID, id.UserID, strings.TrimSpace(in.Reason), amount); e != nil {
			fail(w, 503, "Could not save refund")
			return
		}
		if _, e = tx.Exec("INSERT INTO pos_refund_lines(id,organization_id,refund_id,sale_line_id,quantity,amount) VALUES(?,?,?,?,?,?)", "refund_line_"+token(), id.OrganizationID, entityID, in.SaleLineID, in.Quantity, amount); e != nil {
			fail(w, 503, "Could not save refund line")
			return
		}
		result = map[string]any{"refundId": entityID, "refundNumber": number, "refundAmount": amount, "quantity": in.Quantity}
	case "close":
		var cashier, status string
		var opening int64
		e = tx.QueryRow("SELECT cashier_id,status,opening_cash FROM pos_shifts WHERE id=? AND organization_id=?", in.ShiftID, id.OrganizationID).Scan(&cashier, &status, &opening)
		if errors.Is(e, sql.ErrNoRows) {
			fail(w, 404, "Shift not found")
			return
		}
		if e != nil {
			fail(w, 503, "Cannot read shift")
			return
		}
		if status != "open" {
			fail(w, 409, "Shift is not open")
			return
		}
		if cashier != id.UserID && grant.Role != "admin" {
			fail(w, 403, "Cannot close another cashier's shift")
			return
		}
		var sales, movements, refunds int64
		if e = tx.QueryRow("SELECT COALESCE(SUM(total_amount),0) FROM pos_sales WHERE organization_id=? AND shift_id=? AND status='completed' AND payment_method='cash'", id.OrganizationID, in.ShiftID).Scan(&sales); e != nil {
			fail(w, 503, "Cannot calculate shift sales")
			return
		}
		if e = tx.QueryRow("SELECT COALESCE(SUM(CASE WHEN movement_type='in' THEN amount WHEN movement_type='out' THEN -amount ELSE 0 END),0) FROM pos_cash_movements WHERE organization_id=? AND shift_id=?", id.OrganizationID, in.ShiftID).Scan(&movements); e != nil {
			fail(w, 503, "Cannot calculate cash movements")
			return
		}
		if e = tx.QueryRow("SELECT COALESCE(SUM(r.refund_amount),0) FROM pos_refunds r JOIN pos_sales s ON s.id=r.original_sale_id AND s.organization_id=r.organization_id WHERE s.organization_id=? AND s.shift_id=? AND s.payment_method='cash'", id.OrganizationID, in.ShiftID).Scan(&refunds); e != nil {
			fail(w, 503, "Cannot calculate shift refunds")
			return
		}
		expected := opening + sales + movements - refunds
		entityID = in.ShiftID
		if _, e = tx.Exec("UPDATE pos_shifts SET status='closed',closing_cash=?,expected_cash=?,cash_discrepancy=?,closed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='open'", in.ClosingCash, expected, in.ClosingCash-expected, in.ShiftID, id.OrganizationID); e != nil {
			fail(w, 503, "Could not close shift")
			return
		}
		result = map[string]any{"shiftId": in.ShiftID, "status": "closed", "expectedCash": expected, "closingCash": in.ClosingCash, "discrepancy": in.ClosingCash - expected}
	}
	encoded, _ := json.Marshal(result)
	if _, e = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", "idem_"+token(), id.OrganizationID, in.IdempotencyKey, endpoint, fingerprint, string(encoded)); e != nil {
		fail(w, 503, "Unable to save retry state")
		return
	}
	if _, e = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,after_value) VALUES(?,?,?,?,?,'pos',?,?)", "audit_"+token(), id.OrganizationID, id.UserID, grant.Role, "pos."+in.Action, entityID, string(encoded)); e != nil {
		fail(w, 503, "Unable to record point-of-sale audit")
		return
	}
	if e = tx.Commit(); e != nil {
		fail(w, 503, "Point-of-sale transaction failed")
		return
	}
	ok(w, result)
}
