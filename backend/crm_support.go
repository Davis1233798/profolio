package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"
)

// SLA uses Taipei business hours, Monday through Friday; public holidays are not excluded.
func crmSLADue(start time.Time, hours int) time.Time {
	zone := time.FixedZone("Asia/Taipei", 8*60*60)
	current := start.In(zone)
	remaining := time.Duration(hours) * time.Hour
	for remaining > 0 {
		day := current.Weekday()
		if day == time.Saturday || day == time.Sunday {
			days := 1
			if day == time.Saturday {
				days = 2
			}
			next := current.AddDate(0, 0, days)
			current = time.Date(next.Year(), next.Month(), next.Day(), 9, 0, 0, 0, zone)
			continue
		}
		begin := time.Date(current.Year(), current.Month(), current.Day(), 9, 0, 0, 0, zone)
		end := time.Date(current.Year(), current.Month(), current.Day(), 18, 0, 0, 0, zone)
		if current.Before(begin) {
			current = begin
			continue
		}
		if !current.Before(end) {
			next := current.AddDate(0, 0, 1)
			current = time.Date(next.Year(), next.Month(), next.Day(), 9, 0, 0, 0, zone)
			continue
		}
		available := end.Sub(current)
		if remaining <= available {
			current = current.Add(remaining)
			break
		}
		remaining -= available
		next := current.AddDate(0, 0, 1)
		current = time.Date(next.Year(), next.Month(), next.Day(), 9, 0, 0, 0, zone)
	}
	return current.UTC()
}

type crmSupportRequest struct {
	Action    string `json:"action"`
	AccountID string `json:"accountId"`
	ContactID string `json:"contactId"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	Phone     string `json:"phone"`
	Title     string `json:"title"`
	Consent   bool   `json:"marketingConsent"`
	Subject   string `json:"subject"`
	Priority  string `json:"priority"`
	SLAHours  int    `json:"slaHours"`
	Key       string `json:"idempotencyKey"`
}

func (a *App) crmSupport(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Use POST")
		return
	}
	if g.Role == "readonly" || g.Scope != "back" {
		fail(w, 403, "Write-enabled back-office access required")
		return
	}
	var in crmSupportRequest
	if body(r, &in) != nil || len(in.Key) < 8 || len(in.Key) > 128 || len(in.AccountID) > 256 || len(in.ContactID) > 256 || (in.Action != "contact" && in.Action != "revoke" && in.Action != "ticket") {
		fail(w, 400, "Invalid CRM request")
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	in.Email = strings.ToLower(strings.TrimSpace(in.Email))
	in.Phone = strings.TrimSpace(in.Phone)
	in.Title = strings.TrimSpace(in.Title)
	in.Subject = strings.TrimSpace(in.Subject)
	if in.Action == "contact" {
		address, e := mail.ParseAddress(in.Email)
		if e != nil || address.Address != in.Email || len(in.Email) > 254 || len(in.Name) == 0 || len(in.Name) > 150 || len(in.Phone) > 30 || len(in.Title) > 120 {
			fail(w, 400, "Enter valid contact details")
			return
		}
	}
	if in.Action == "revoke" && in.ContactID == "" {
		fail(w, 400, "Select a contact")
		return
	}
	if in.Action == "ticket" && (len(in.Subject) == 0 || len(in.Subject) > 300 || in.SLAHours < 1 || in.SLAHours > 720 || (in.Priority != "low" && in.Priority != "medium" && in.Priority != "high" && in.Priority != "urgent")) {
		fail(w, 400, "Enter valid support ticket details")
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
	endpoint := "/station/crm/support/" + in.Action
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
	if in.AccountID != "" {
		var count int
		e = tx.QueryRow("SELECT count(*) FROM crm_accounts WHERE organization_id=? AND id=?", id.OrganizationID, in.AccountID).Scan(&count)
		if e != nil {
			fail(w, 503, "Cannot validate customer")
			return
		}
		if count != 1 {
			fail(w, 404, "Customer not found")
			return
		}
	}
	switch in.Action {
	case "contact":
		var count int
		e = tx.QueryRow("SELECT count(*) FROM crm_contacts WHERE organization_id=? AND lower(email)=?", id.OrganizationID, in.Email).Scan(&count)
		if e != nil {
			fail(w, 503, "Cannot check contact")
			return
		}
		if count > 0 {
			fail(w, 409, "A contact with this email already exists")
			return
		}
		entity = "contact_" + token()
		var account any = nil
		if in.AccountID != "" {
			account = in.AccountID
		}
		_, e = tx.Exec("INSERT INTO crm_contacts(id,organization_id,account_id,name,email,phone,title) VALUES(?,?,?,?,?,?,?)", entity, id.OrganizationID, account, in.Name, in.Email, in.Phone, in.Title)
		allowed := 0
		if in.Consent {
			allowed = 1
		}
		if e == nil {
			_, e = tx.Exec("INSERT INTO crm_consents(id,organization_id,contact_id,email,marketing_email_allowed) VALUES(?,?,?,?,?)", "consent_"+token(), id.OrganizationID, entity, in.Email, allowed)
		}
		result["contactId"] = entity
	case "revoke":
		entity = in.ContactID
		var count int
		e = tx.QueryRow("SELECT count(*) FROM crm_contacts WHERE organization_id=? AND id=?", id.OrganizationID, entity).Scan(&count)
		if e != nil {
			fail(w, 503, "Cannot read contact")
			return
		}
		if count == 0 {
			fail(w, 404, "Contact not found")
			return
		}
		_, e = tx.Exec("UPDATE crm_consents SET marketing_email_allowed=0,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND contact_id=?", id.OrganizationID, entity)
		result["marketingConsent"] = false
	case "ticket":
		if in.ContactID != "" {
			var count int
			e = tx.QueryRow("SELECT count(*) FROM crm_contacts WHERE organization_id=? AND id=? AND (?='' OR account_id=?)", id.OrganizationID, in.ContactID, in.AccountID, in.AccountID).Scan(&count)
			if e != nil {
				fail(w, 503, "Cannot validate contact")
				return
			}
			if count != 1 {
				fail(w, 404, "Contact not found for this customer")
				return
			}
		}
		entity = "ticket_" + token()
		number := "TCK-" + strings.ToUpper(token()[:12])
		created := time.Now().UTC()
		due := crmSLADue(created, in.SLAHours)
		var account, contact any = nil, nil
		if in.AccountID != "" {
			account = in.AccountID
		}
		if in.ContactID != "" {
			contact = in.ContactID
		}
		_, e = tx.Exec("INSERT INTO crm_tickets(id,organization_id,ticket_number,customer_id,contact_id,subject,priority,status,sla_hours,is_sla_breached,created_at) VALUES(?,?,?,?,?,?,?,'new',?,0,?)", entity, id.OrganizationID, number, account, contact, in.Subject, in.Priority, in.SLAHours, created.Format(time.RFC3339))
		result = map[string]any{"ticketId": entity, "ticketNumber": number, "dueAt": due.Format(time.RFC3339)}
	}
	if e != nil {
		fail(w, 503, "Cannot save CRM operation")
		return
	}
	encoded, _ := json.Marshal(result)
	_, e = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", "idem_"+token(), id.OrganizationID, in.Key, endpoint, hash, string(encoded))
	if e == nil {
		_, e = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,after_value) VALUES(?,?,?,?,?,'crm',?,?)", "audit_"+token(), id.OrganizationID, id.UserID, g.Role, "crm.support."+in.Action, entity, string(encoded))
	}
	if e != nil {
		fail(w, 503, "Cannot record CRM operation")
		return
	}
	if tx.Commit() != nil {
		fail(w, 503, "Cannot commit CRM operation")
		return
	}
	ok(w, result)
}
