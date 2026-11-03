package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"strings"
)

type crmRequest struct {
	Action         string `json:"action"`
	Name           string `json:"name"`
	Company        string `json:"company"`
	Email          string `json:"email"`
	LeadID         string `json:"leadId"`
	Amount         int64  `json:"amount"`
	IdempotencyKey string `json:"idempotencyKey"`
}

// Lead creation and conversion run in one transaction with tenant-scoped retries.
func (a *App) crmBusiness(w http.ResponseWriter, r *http.Request, id *Identity, grant *Grant) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Use POST")
		return
	}
	if grant.Role == "readonly" {
		fail(w, 403, "A write-enabled role is required")
		return
	}
	var in crmRequest
	if body(r, &in) != nil {
		fail(w, 400, "Invalid request")
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	in.Company = strings.TrimSpace(in.Company)
	in.Email = strings.TrimSpace(in.Email)
	if len(in.IdempotencyKey) < 8 || len(in.IdempotencyKey) > 128 || (in.Action != "create" && in.Action != "convert") || len(in.Name) > 120 || len(in.Company) > 160 || len(in.Email) > 254 || len(in.LeadID) > 256 || in.Amount < 0 || in.Amount > 1000000000 {
		fail(w, 400, "Invalid lead details")
		return
	}
	if in.Action == "create" {
		address, e := mail.ParseAddress(in.Email)
		if in.Name == "" || e != nil || address.Address != in.Email {
			fail(w, 400, "Enter a name and valid email address")
			return
		}
	}
	if in.Action == "convert" && in.LeadID == "" {
		fail(w, 400, "Select a lead")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, 503, "CRM unavailable")
		return
	}
	defer tx.Rollback()
	raw, _ := json.Marshal(in)
	hash := digest(id.UserID + "\x00" + string(raw))
	endpoint := "/station/crm/" + in.Action
	var oldHash, oldBody string
	e = tx.QueryRow("SELECT request_hash,response_body FROM idempotency_keys WHERE organization_id=? AND key=? AND endpoint=?", id.OrganizationID, in.IdempotencyKey, endpoint).Scan(&oldHash, &oldBody)
	if e == nil {
		if oldHash != hash {
			fail(w, 409, "Retry key was used for a different request")
			return
		}
		var value map[string]any
		if json.Unmarshal([]byte(oldBody), &value) != nil {
			fail(w, 500, "Invalid stored result")
			return
		}
		ok(w, value)
		return
	}
	if !errors.Is(e, sql.ErrNoRows) {
		fail(w, 503, "Cannot read retry state")
		return
	}
	result := map[string]any{}
	entity := ""
	if in.Action == "create" {
		var count int
		if e = tx.QueryRow("SELECT count(*) FROM crm_leads WHERE organization_id=? AND lower(email)=lower(?) AND status!='converted'", id.OrganizationID, in.Email).Scan(&count); e != nil {
			fail(w, 503, "Cannot check duplicate leads")
			return
		}
		if count > 0 {
			fail(w, 409, "An active lead with this email already exists")
			return
		}
		entity = "lead_" + token()
		_, e = tx.Exec("INSERT INTO crm_leads(id,organization_id,name,company,email,status,assigned_to) VALUES(?,?,?,?,?,'new',?)", entity, id.OrganizationID, in.Name, in.Company, in.Email, id.UserID)
		if e != nil {
			fail(w, 503, "Cannot create lead")
			return
		}
		result["leadId"] = entity
	} else {
		var name, company, email, status string
		var account, contact, opportunity, assigned sql.NullString
		e = tx.QueryRow("SELECT name,COALESCE(company,''),email,status,converted_account_id,converted_contact_id,converted_opportunity_id,assigned_to FROM crm_leads WHERE organization_id=? AND id=?", id.OrganizationID, in.LeadID).Scan(&name, &company, &email, &status, &account, &contact, &opportunity, &assigned)
		if errors.Is(e, sql.ErrNoRows) {
			fail(w, 404, "Lead not found")
			return
		}
		if e != nil {
			fail(w, 503, "Cannot read lead")
			return
		}
		entity = in.LeadID
		if status == "converted" {
			result = map[string]any{"alreadyConverted": true, "accountId": account.String, "contactId": contact.String, "opportunityId": opportunity.String}
		} else {
			owner := id.UserID
			if assigned.Valid && assigned.String != "" {
				var active int
				e = tx.QueryRow(`SELECT count(*) FROM station_accounts a JOIN station_grants g ON g.user_id=a.user_id WHERE a.organization_id=? AND a.user_id=? AND a.disabled=0 AND g.site='crm' AND g.enabled=1`, id.OrganizationID, assigned.String).Scan(&active)
				if e != nil {
					fail(w, 503, "Cannot validate lead assignee")
					return
				}
				if active != 1 {
					fail(w, 409, "Lead assignee is unavailable or no longer has CRM access")
					return
				}
				owner = assigned.String
			}
			if company == "" {
				company = name
			}
			var stage string
			var probability int64
			e = tx.QueryRow("SELECT id,probability FROM crm_stages WHERE organization_id=? ORDER BY position LIMIT 1", id.OrganizationID).Scan(&stage, &probability)
			if e != nil {
				fail(w, 409, "Configure a sales stage before converting leads")
				return
			}
			acc, con, opp := "crm_acc_"+token(), "crm_cont_"+token(), "crm_opp_"+token()
			_, e = tx.Exec("INSERT INTO crm_accounts(id,organization_id,name,email,owner_id) VALUES(?,?,?,?,?)", acc, id.OrganizationID, company, email, owner)
			if e == nil {
				_, e = tx.Exec("INSERT INTO crm_contacts(id,organization_id,account_id,name,email) VALUES(?,?,?,?,?)", con, id.OrganizationID, acc, name, email)
			}
			if e == nil {
				_, e = tx.Exec("INSERT INTO crm_opportunities(id,organization_id,name,account_id,primary_contact_id,owner_id,stage_id,amount,weighted_amount,probability,status) VALUES(?,?,?,?,?,?,?,?,?,?,'open')", opp, id.OrganizationID, company+" opportunity", acc, con, owner, stage, in.Amount, (in.Amount*probability+50)/100, probability)
			}
			if e == nil {
				_, e = tx.Exec("UPDATE crm_leads SET status='converted',converted_account_id=?,converted_contact_id=?,converted_opportunity_id=? WHERE organization_id=? AND id=? AND status!='converted'", acc, con, opp, id.OrganizationID, in.LeadID)
			}
			if e != nil {
				fail(w, 503, "Cannot convert lead")
				return
			}
			result = map[string]any{"alreadyConverted": false, "accountId": acc, "contactId": con, "opportunityId": opp}
		}
	}
	encoded, _ := json.Marshal(result)
	_, e = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", "idem_"+token(), id.OrganizationID, in.IdempotencyKey, endpoint, hash, string(encoded))
	if e == nil {
		_, e = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,after_value) VALUES(?,?,?,?,?,'crm_lead',?,?)", "audit_"+token(), id.OrganizationID, id.UserID, grant.Role, "crm."+in.Action, entity, string(encoded))
	}
	if e != nil {
		fail(w, 503, "Cannot record CRM transaction")
		return
	}
	if e = tx.Commit(); e != nil {
		fail(w, 503, "CRM transaction failed")
		return
	}
	ok(w, result)
}
