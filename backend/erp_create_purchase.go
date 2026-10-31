package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type newPurchaseLine struct {
	ItemID    string `json:"itemId"`
	Quantity  int64  `json:"quantity"`
	UnitPrice int64  `json:"unitPrice"`
}
type newPurchaseRequest struct {
	SupplierID string            `json:"supplierId"`
	Lines      []newPurchaseLine `json:"lines"`
	Key        string            `json:"idempotencyKey"`
}

func (a *App) erpCreatePurchase(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Use POST")
		return
	}
	if g.Role == "readonly" || g.Scope != "back" {
		fail(w, 403, "Write-enabled back-office access required")
		return
	}
	var in newPurchaseRequest
	if body(r, &in) != nil || len(in.SupplierID) == 0 || len(in.SupplierID) > 256 || len(in.Lines) == 0 || len(in.Lines) > 100 || len(in.Key) < 8 || len(in.Key) > 128 {
		fail(w, 400, "Enter valid purchase details")
		return
	}
	var total int64
	seen := map[string]bool{}
	for _, line := range in.Lines {
		if len(line.ItemID) == 0 || len(line.ItemID) > 256 || seen[line.ItemID] || line.Quantity < 1 || line.Quantity > 1000000 || line.UnitPrice < 0 || line.UnitPrice > 1000000000 {
			fail(w, 400, "Invalid or duplicate purchase item")
			return
		}
		seen[line.ItemID] = true
		value := line.Quantity * line.UnitPrice
		if total > 1000000000000000-value {
			fail(w, 400, "Purchase total exceeds limit")
			return
		}
		total += value
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, 503, "Purchasing unavailable")
		return
	}
	defer tx.Rollback()
	raw, _ := json.Marshal(in)
	hash := digest(id.UserID + "\x00" + string(raw))
	const endpoint = "/station/erp/purchase/create"
	var oldHash, oldBody string
	e = tx.QueryRow("SELECT request_hash,response_body FROM idempotency_keys WHERE organization_id=? AND key=? AND endpoint=?", id.OrganizationID, in.Key, endpoint).Scan(&oldHash, &oldBody)
	if e == nil {
		if hash != oldHash {
			fail(w, 409, "Retry key already used")
			return
		}
		var result map[string]any
		if json.Unmarshal([]byte(oldBody), &result) != nil {
			fail(w, 500, "Invalid retry result")
			return
		}
		ok(w, result)
		return
	}
	if !errors.Is(e, sql.ErrNoRows) {
		fail(w, 503, "Cannot read retry state")
		return
	}
	var count int
	e = tx.QueryRow("SELECT count(*) FROM erp_suppliers WHERE organization_id=? AND id=? AND is_active=1", id.OrganizationID, in.SupplierID).Scan(&count)
	if e != nil {
		fail(w, 503, "Cannot validate supplier")
		return
	}
	if count != 1 {
		fail(w, 404, "Active supplier not found")
		return
	}
	for _, line := range in.Lines {
		e = tx.QueryRow("SELECT count(*) FROM erp_items WHERE organization_id=? AND id=? AND is_active=1", id.OrganizationID, line.ItemID).Scan(&count)
		if e != nil {
			fail(w, 503, "Cannot validate item")
			return
		}
		if count != 1 {
			fail(w, 404, "Active item not found")
			return
		}
	}
	po := "po_" + token()
	number := "PO-" + strings.ToUpper(token()[:12])
	_, e = tx.Exec("INSERT INTO erp_purchase_orders(id,organization_id,po_number,supplier_id,status,total_amount) VALUES(?,?,?,?,'submitted',?)", po, id.OrganizationID, number, in.SupplierID, total)
	for _, line := range in.Lines {
		if e != nil {
			break
		}
		_, e = tx.Exec("INSERT INTO erp_purchase_order_lines(id,organization_id,po_id,item_id,quantity,unit_price,received_quantity) VALUES(?,?,?,?,?,?,0)", "poline_"+token(), id.OrganizationID, po, line.ItemID, line.Quantity, line.UnitPrice)
	}
	result := map[string]any{"poId": po, "poNumber": number, "total": total}
	encoded, _ := json.Marshal(result)
	if e == nil {
		_, e = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", "idem_"+token(), id.OrganizationID, in.Key, endpoint, hash, string(encoded))
	}
	if e == nil {
		_, e = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,after_value) VALUES(?,?,?,?,'erp.purchase.create','erp_purchase',?,?)", "audit_"+token(), id.OrganizationID, id.UserID, g.Role, po, string(encoded))
	}
	if e != nil {
		fail(w, 503, "Cannot save purchase order")
		return
	}
	if tx.Commit() != nil {
		fail(w, 503, "Cannot commit purchase order")
		return
	}
	ok(w, result)
}
