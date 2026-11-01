package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

// crmAssignLead changes only an unconverted lead and records the administrator's action.
func (a *App) crmAssignLead(w http.ResponseWriter, r *http.Request, id *Identity, grant *Grant) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Use POST")
		return
	}
	if grant.Role != "admin" || grant.Scope != "back" {
		fail(w, 403, "CRM administrator access required")
		return
	}
	var input struct {
		LeadID string `json:"leadId"`
		UserID string `json:"userId"`
		Key    string `json:"idempotencyKey"`
	}
	if body(r, &input) != nil || strings.TrimSpace(input.LeadID) == "" || len(input.LeadID) > 256 || strings.TrimSpace(input.UserID) == "" || len(input.UserID) > 256 || len(input.Key) < 8 || len(input.Key) > 128 {
		fail(w, 400, "Invalid assignment")
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		fail(w, 503, "CRM unavailable")
		return
	}
	defer tx.Rollback()
	raw, _ := json.Marshal(input)
	hash := digest(id.UserID + "\x00" + string(raw))
	const endpoint = "/station/crm/assign-lead"
	var oldHash, oldBody string
	err = tx.QueryRow("SELECT request_hash,response_body FROM idempotency_keys WHERE organization_id=? AND key=? AND endpoint=?", id.OrganizationID, input.Key, endpoint).Scan(&oldHash, &oldBody)
	if err == nil {
		if oldHash != hash {
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
	if !errors.Is(err, sql.ErrNoRows) {
		fail(w, 503, "Cannot read retry state")
		return
	}
	var active int
	err = tx.QueryRow(`SELECT count(*) FROM station_accounts a JOIN station_grants g ON g.user_id=a.user_id WHERE a.organization_id=? AND a.user_id=? AND a.disabled=0 AND g.site='crm' AND g.enabled=1 AND g.scope='back' AND g.role IN ('admin','operator')`, id.OrganizationID, input.UserID).Scan(&active)
	if err != nil {
		fail(w, 503, "Cannot validate assignee")
		return
	}
	if active != 1 {
		fail(w, 409, "Select an active CRM back-office operator")
		return
	}
	var previous sql.NullString
	var status string
	err = tx.QueryRow("SELECT assigned_to,status FROM crm_leads WHERE id=? AND organization_id=?", input.LeadID, id.OrganizationID).Scan(&previous, &status)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "Lead not found")
		return
	}
	if err != nil {
		fail(w, 503, "Cannot read lead")
		return
	}
	if status == "converted" {
		fail(w, 409, "Converted leads cannot be reassigned")
		return
	}
	if _, err = tx.Exec("UPDATE crm_leads SET assigned_to=? WHERE id=? AND organization_id=? AND status!='converted'", input.UserID, input.LeadID, id.OrganizationID); err != nil {
		fail(w, 503, "Cannot assign lead")
		return
	}
	result := map[string]any{"leadId": input.LeadID, "assignedTo": input.UserID}
	encoded, _ := json.Marshal(result)
	before, _ := json.Marshal(map[string]any{"assignedTo": previous.String})
	_, err = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", "idem_"+token(), id.OrganizationID, input.Key, endpoint, hash, string(encoded))
	if err == nil {
		_, err = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,before_value,after_value) VALUES(?,?,?,?,?,'crm_lead',?,?,?)", "audit_"+token(), id.OrganizationID, id.UserID, grant.Role, "crm.assign", input.LeadID, string(before), string(encoded))
	}
	if err != nil {
		fail(w, 503, "Cannot record assignment")
		return
	}
	if err = tx.Commit(); err != nil {
		fail(w, 503, "Assignment failed")
		return
	}
	ok(w, result)
}
