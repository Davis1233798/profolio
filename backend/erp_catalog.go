package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type erpCatalogLine struct {
	ItemID    string `json:"itemId"`
	Quantity  int64  `json:"quantity"`
	UnitPrice int64  `json:"unitPrice"`
}
type erpCatalogRequest struct {
	Action     string           `json:"action"`
	SKU        string           `json:"sku"`
	Name       string           `json:"name"`
	Unit       string           `json:"unit"`
	Category   string           `json:"category"`
	BoxRatio   int64            `json:"boxRatio"`
	CustomerID string           `json:"customerId"`
	Lines      []erpCatalogLine `json:"lines"`
	Key        string           `json:"idempotencyKey"`
}

func (a *App) erpCatalog(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Use POST")
		return
	}
	if g.Role == "readonly" || g.Scope != "back" {
		fail(w, 403, "Write-enabled back-office access required")
		return
	}
	var in erpCatalogRequest
	if body(r, &in) != nil || len(in.Key) < 8 || len(in.Key) > 128 || (in.Action != "item" && in.Action != "sale") || len(in.CustomerID) > 256 {
		fail(w, 400, "Invalid ERP request")
		return
	}
	in.SKU = strings.TrimSpace(in.SKU)
	in.Name = strings.TrimSpace(in.Name)
	in.Unit = strings.TrimSpace(in.Unit)
	in.Category = strings.TrimSpace(in.Category)
	if in.Action == "item" && (in.SKU == "" || len(in.SKU) > 128 || in.Name == "" || len(in.Name) > 200 || in.Unit == "" || len(in.Unit) > 20 || len(in.Category) > 100 || in.BoxRatio < 1 || in.BoxRatio > 1000000) {
		fail(w, 400, "Enter valid item details")
		return
	}
	var total int64
	seen := map[string]bool{}
	if in.Action == "sale" {
		if in.CustomerID == "" || len(in.Lines) < 1 || len(in.Lines) > 100 {
			fail(w, 400, "Select a customer and items")
			return
		}
		for _, l := range in.Lines {
			if l.ItemID == "" || len(l.ItemID) > 256 || seen[l.ItemID] || l.Quantity < 1 || l.Quantity > 1000000 || l.UnitPrice < 0 || l.UnitPrice > 1000000000 {
				fail(w, 400, "Invalid or duplicate sales item")
				return
			}
			seen[l.ItemID] = true
			v := l.Quantity * l.UnitPrice
			if total > 1000000000000000-v {
				fail(w, 400, "Sales total exceeds limit")
				return
			}
			total += v
		}
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, 503, "ERP unavailable")
		return
	}
	defer tx.Rollback()
	raw, _ := json.Marshal(in)
	hash := digest(id.UserID + "\x00" + string(raw))
	endpoint := "/station/erp/catalog/" + in.Action
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
	entity := ""
	result := map[string]any{}
	if in.Action == "item" {
		e = tx.QueryRow("SELECT count(*) FROM erp_items WHERE organization_id=? AND lower(sku)=lower(?)", id.OrganizationID, in.SKU).Scan(&count)
		if e != nil {
			fail(w, 503, "Cannot validate SKU")
			return
		}
		if count != 0 {
			fail(w, 409, "SKU already exists")
			return
		}
		entity = "item_" + token()
		_, e = tx.Exec("INSERT INTO erp_items(id,organization_id,sku,name,unit,box_conversion_ratio,category,is_active) VALUES(?,?,?,?,?,?,?,1)", entity, id.OrganizationID, in.SKU, in.Name, in.Unit, in.BoxRatio, in.Category)
		result["itemId"] = entity
	} else {
		e = tx.QueryRow("SELECT count(*) FROM erp_customers WHERE organization_id=? AND id=? AND is_active=1", id.OrganizationID, in.CustomerID).Scan(&count)
		if e != nil {
			fail(w, 503, "Cannot validate customer")
			return
		}
		if count != 1 {
			fail(w, 404, "Active customer not found")
			return
		}
		for _, l := range in.Lines {
			e = tx.QueryRow("SELECT count(*) FROM erp_items WHERE organization_id=? AND id=? AND is_active=1", id.OrganizationID, l.ItemID).Scan(&count)
			if e != nil {
				fail(w, 503, "Cannot validate item")
				return
			}
			if count != 1 {
				fail(w, 404, "Active item not found")
				return
			}
		}
		entity = "sales_order_" + token()
		number := "SO-" + strings.ToUpper(token()[:12])
		_, e = tx.Exec("INSERT INTO erp_sales_orders(id,organization_id,so_number,customer_id,status,total_amount) VALUES(?,?,?,?,'confirmed',?)", entity, id.OrganizationID, number, in.CustomerID, total)
		for _, l := range in.Lines {
			if e != nil {
				break
			}
			_, e = tx.Exec("INSERT INTO erp_sales_order_lines(id,organization_id,so_id,item_id,quantity,unit_price,shipped_quantity) VALUES(?,?,?,?,?,?,0)", "sales_line_"+token(), id.OrganizationID, entity, l.ItemID, l.Quantity, l.UnitPrice)
		}
		result = map[string]any{"salesOrderId": entity, "salesOrderNumber": number, "total": total}
	}
	if e != nil {
		fail(w, 503, "Cannot save ERP transaction")
		return
	}
	encoded, _ := json.Marshal(result)
	_, e = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", "idem_"+token(), id.OrganizationID, in.Key, endpoint, hash, string(encoded))
	if e == nil {
		_, e = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,after_value) VALUES(?,?,?,?,?,'erp',?,?)", "audit_"+token(), id.OrganizationID, id.UserID, g.Role, "erp.catalog."+in.Action, entity, string(encoded))
	}
	if e != nil {
		fail(w, 503, "Cannot record ERP transaction")
		return
	}
	if tx.Commit() != nil {
		fail(w, 503, "Cannot commit ERP transaction")
		return
	}
	ok(w, result)
}
