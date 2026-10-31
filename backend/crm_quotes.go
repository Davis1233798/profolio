package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type crmQuoteRequest struct {
	Action        string `json:"action"`
	OpportunityID string `json:"opportunityId"`
	QuoteID       string `json:"quoteId"`
	ItemName      string `json:"itemName"`
	Quantity      int64  `json:"quantity"`
	UnitPrice     int64  `json:"unitPrice"`
	Key           string `json:"idempotencyKey"`
}

func (a *App) crmQuotes(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Use POST")
		return
	}
	if g.Role == "readonly" || g.Scope != "back" {
		fail(w, 403, "Write-enabled back-office access required")
		return
	}
	var in crmQuoteRequest
	if body(r, &in) != nil || len(in.Key) < 8 || len(in.Key) > 128 || len(in.OpportunityID) > 256 || len(in.QuoteID) > 256 || (in.Action != "create" && in.Action != "approve") {
		fail(w, 400, "Invalid quote request")
		return
	}
	in.ItemName = strings.TrimSpace(in.ItemName)
	if in.Action == "create" && (in.OpportunityID == "" || len(in.ItemName) == 0 || len(in.ItemName) > 200 || in.Quantity < 1 || in.Quantity > 1000000 || in.UnitPrice < 0 || in.UnitPrice > 1000000000) {
		fail(w, 400, "Enter valid quote details")
		return
	}
	if in.Action == "approve" {
		if g.Role != "admin" {
			fail(w, 403, "Manager role required for approval")
			return
		}
		if in.QuoteID == "" {
			fail(w, 400, "Select a quote")
			return
		}
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, 503, "CRM unavailable")
		return
	}
	defer tx.Rollback()
	raw, _ := json.Marshal(in)
	hash := digest(id.UserID + "\x00" + string(raw))
	endpoint := "/station/crm/quote/" + in.Action
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
	result := map[string]any{}
	entity := ""
	if in.Action == "create" {
		var found int
		e = tx.QueryRow("SELECT count(*) FROM crm_opportunities WHERE organization_id=? AND id=?", id.OrganizationID, in.OpportunityID).Scan(&found)
		if e != nil {
			fail(w, 503, "Cannot read opportunity")
			return
		}
		if found == 0 {
			fail(w, 404, "Opportunity not found")
			return
		}
		var version int64
		e = tx.QueryRow("SELECT COALESCE(MAX(version),0)+1 FROM crm_quotes WHERE organization_id=? AND opportunity_id=?", id.OrganizationID, in.OpportunityID).Scan(&version)
		if e != nil || version > 1000000000 {
			fail(w, 503, "Cannot allocate quote version")
			return
		}
		entity = "quote_" + token()
		number := "QT-" + strings.ToUpper(token()[:12])
		total := in.Quantity * in.UnitPrice
		_, e = tx.Exec("INSERT INTO crm_quotes(id,organization_id,quote_number,opportunity_id,version,total_amount,status,is_locked) VALUES(?,?,?,?,?,?,'submitted',0)", entity, id.OrganizationID, number, in.OpportunityID, version, total)
		if e == nil {
			_, e = tx.Exec("INSERT INTO crm_quote_items(id,organization_id,quote_id,item_name,quantity,unit_price,line_total) VALUES(?,?,?,?,?,?,?)", "quoteitem_"+token(), id.OrganizationID, entity, in.ItemName, in.Quantity, in.UnitPrice, total)
		}
		result = map[string]any{"quoteId": entity, "quoteNumber": number, "version": version, "total": total}
	} else {
		entity = in.QuoteID
		var locked int
		var status string
		var total int64
		e = tx.QueryRow("SELECT is_locked,status,total_amount FROM crm_quotes WHERE organization_id=? AND id=?", id.OrganizationID, entity).Scan(&locked, &status, &total)
		if errors.Is(e, sql.ErrNoRows) {
			fail(w, 404, "Quote not found")
			return
		}
		if e != nil {
			fail(w, 503, "Cannot read quote")
			return
		}
		if locked != 0 || status != "submitted" {
			fail(w, 409, "Quote cannot be approved in its current state")
			return
		}
		_, e = tx.Exec("UPDATE crm_quotes SET status='approved',is_locked=1,approved_at=CURRENT_TIMESTAMP WHERE organization_id=? AND id=? AND is_locked=0 AND status='submitted'", id.OrganizationID, entity)
		result = map[string]any{"quoteId": entity, "total": total, "status": "approved"}
	}
	if e != nil {
		fail(w, 503, "Cannot save quote")
		return
	}
	encoded, _ := json.Marshal(result)
	_, e = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", "idem_"+token(), id.OrganizationID, in.Key, endpoint, hash, string(encoded))
	if e == nil {
		_, e = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,after_value) VALUES(?,?,?,?,?,'crm_quote',?,?)", "audit_"+token(), id.OrganizationID, id.UserID, g.Role, "crm.quote."+in.Action, entity, string(encoded))
	}
	if e != nil {
		fail(w, 503, "Cannot record quote operation")
		return
	}
	if tx.Commit() != nil {
		fail(w, 503, "Cannot commit quote operation")
		return
	}
	ok(w, result)
}
