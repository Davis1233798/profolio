package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"strings"
)

type erpAdminRequest struct {
	Action   string `json:"action"`
	Kind     string `json:"kind"`
	Code     string `json:"code"`
	Name     string `json:"name"`
	Email    string `json:"email"`
	PeriodID string `json:"periodId"`
	Key      string `json:"idempotencyKey"`
}

func (a *App) erpAdministration(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Use POST")
		return
	}
	if g.Role == "readonly" || g.Scope != "back" {
		fail(w, 403, "Write-enabled back-office access required")
		return
	}
	var in erpAdminRequest
	if body(r, &in) != nil || len(in.Key) < 8 || len(in.Key) > 128 || len(in.PeriodID) > 256 || (in.Action != "partner" && in.Action != "closePeriod") {
		fail(w, 400, "Invalid ERP request")
		return
	}
	in.Code = strings.TrimSpace(in.Code)
	in.Name = strings.TrimSpace(in.Name)
	in.Email = strings.TrimSpace(in.Email)
	if in.Action == "partner" {
		if (in.Kind != "supplier" && in.Kind != "customer") || in.Code == "" || len(in.Code) > 100 || in.Name == "" || len(in.Name) > 200 || len(in.Email) > 254 {
			fail(w, 400, "Enter valid partner details")
			return
		}
		if in.Email != "" {
			address, e := mail.ParseAddress(in.Email)
			if e != nil || address.Address != in.Email {
				fail(w, 400, "Enter a valid contact email")
				return
			}
		}
	} else {
		if g.Role != "admin" {
			fail(w, 403, "Manager role required to close a period")
			return
		}
		if in.PeriodID == "" {
			fail(w, 400, "Select a fiscal period")
			return
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
	endpoint := "/station/erp/administration/" + in.Action
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
	entity := ""
	result := map[string]any{}
	if in.Action == "partner" {
		table := "erp_suppliers"
		if in.Kind == "customer" {
			table = "erp_customers"
		}
		var count int
		e = tx.QueryRow("SELECT count(*) FROM "+table+" WHERE organization_id=? AND lower(code)=lower(?)", id.OrganizationID, in.Code).Scan(&count)
		if e != nil {
			fail(w, 503, "Cannot validate partner code")
			return
		}
		if count > 0 {
			fail(w, 409, "Partner code already exists")
			return
		}
		entity = in.Kind + "_" + token()
		_, e = tx.Exec("INSERT INTO "+table+"(id,organization_id,code,name,contact_email,is_active) VALUES(?,?,?,?,?,1)", entity, id.OrganizationID, in.Code, in.Name, in.Email)
		result = map[string]any{"partnerId": entity, "kind": in.Kind}
	} else {
		entity = in.PeriodID
		var closed int
		e = tx.QueryRow("SELECT is_closed FROM erp_fiscal_periods WHERE organization_id=? AND id=?", id.OrganizationID, entity).Scan(&closed)
		if errors.Is(e, sql.ErrNoRows) {
			fail(w, 404, "Fiscal period not found")
			return
		}
		if e != nil {
			fail(w, 503, "Cannot read fiscal period")
			return
		}
		if closed != 0 {
			fail(w, 409, "Fiscal period already closed")
			return
		}
		var debit, credit int64
		e = tx.QueryRow("SELECT COALESCE(SUM(l.debit_amount),0),COALESCE(SUM(l.credit_amount),0) FROM erp_journal_lines l JOIN erp_journal_entries j ON j.id=l.journal_id AND j.organization_id=l.organization_id WHERE l.organization_id=? AND j.status='posted'", id.OrganizationID).Scan(&debit, &credit)
		if e != nil {
			fail(w, 503, "Cannot verify trial balance")
			return
		}
		if debit != credit {
			fail(w, 409, "Trial balance is not balanced")
			return
		}
		_, e = tx.Exec("UPDATE erp_fiscal_periods SET is_closed=1 WHERE organization_id=? AND id=? AND is_closed=0", id.OrganizationID, entity)
		result = map[string]any{"periodId": entity, "closed": true}
	}
	if e != nil {
		fail(w, 503, "Cannot save ERP operation")
		return
	}
	encoded, _ := json.Marshal(result)
	_, e = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", "idem_"+token(), id.OrganizationID, in.Key, endpoint, hash, string(encoded))
	if e == nil {
		_, e = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,after_value) VALUES(?,?,?,?,?,'erp_administration',?,?)", "audit_"+token(), id.OrganizationID, id.UserID, g.Role, "erp."+in.Action, entity, string(encoded))
	}
	if e != nil {
		fail(w, 503, "Cannot record ERP operation")
		return
	}
	if tx.Commit() != nil {
		fail(w, 503, "Cannot commit ERP operation")
		return
	}
	ok(w, result)
}
