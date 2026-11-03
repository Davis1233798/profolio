package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

type crmWorkRequest struct {
	Action        string `json:"action"`
	OpportunityID string `json:"opportunityId"`
	ExpectedStage string `json:"expectedStage"`
	StageID       string `json:"stageId"`
	Reason        string `json:"reason"`
	ActivityID    string `json:"activityId"`
	Subject       string `json:"subject"`
	DueDate       string `json:"dueDate"`
	ActivityType  string `json:"activityType"`
	Key           string `json:"idempotencyKey"`
}

func (a *App) crmWork(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Use POST")
		return
	}
	if g.Role == "readonly" {
		fail(w, 403, "A write-enabled role is required")
		return
	}
	var in crmWorkRequest
	if body(r, &in) != nil || len(in.Key) < 8 || len(in.Key) > 128 || len(in.OpportunityID) > 256 || len(in.ExpectedStage) > 256 || len(in.StageID) > 256 || len(in.ActivityID) > 256 || (in.Action != "stage" && in.Action != "createActivity" && in.Action != "completeActivity") {
		fail(w, 400, "Invalid CRM request")
		return
	}
	in.Reason = strings.TrimSpace(in.Reason)
	in.Subject = strings.TrimSpace(in.Subject)
	if in.Action == "stage" {
		if g.Scope != "back" {
			fail(w, 403, "Back-office access required")
			return
		}
		if in.OpportunityID == "" || in.ExpectedStage == "" || in.StageID == "" || len(in.Reason) > 500 {
			fail(w, 400, "Select an opportunity and stage")
			return
		}
	}
	if in.Action == "createActivity" {
		date, e := time.Parse(time.RFC3339, in.DueDate)
		if e != nil || len(in.Subject) == 0 || len(in.Subject) > 300 || (in.ActivityType != "call" && in.ActivityType != "meeting" && in.ActivityType != "task" && in.ActivityType != "email") {
			fail(w, 400, "Enter valid activity details")
			return
		}
		in.DueDate = date.UTC().Format(time.RFC3339)
	}
	if in.Action == "completeActivity" && in.ActivityID == "" {
		fail(w, 400, "Select an activity")
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
	switch in.Action {
	case "stage":
		entity = in.OpportunityID
		var amount int64
		var previous, owner string
		e = tx.QueryRow("SELECT stage_id,amount,owner_id FROM crm_opportunities WHERE organization_id=? AND id=?", id.OrganizationID, entity).Scan(&previous, &amount, &owner)
		if errors.Is(e, sql.ErrNoRows) {
			fail(w, 404, "Opportunity not found")
			return
		}
		if e != nil {
			fail(w, 503, "Cannot read opportunity")
			return
		}
		if g.Role != "admin" && owner != id.UserID {
			fail(w, 403, "Opportunity belongs to another user")
			return
		}
		if previous != in.ExpectedStage {
			fail(w, 409, "Opportunity changed; refresh before updating")
			return
		}
		var probability int64
		var won, lost int
		e = tx.QueryRow("SELECT probability,is_won,is_lost FROM crm_stages WHERE organization_id=? AND id=?", id.OrganizationID, in.StageID).Scan(&probability, &won, &lost)
		if errors.Is(e, sql.ErrNoRows) {
			fail(w, 404, "Stage not found")
			return
		}
		if e != nil {
			fail(w, 503, "Cannot read stage")
			return
		}
		if amount < 0 || amount > 1000000000000 || probability < 0 || probability > 100 || (won != 0 && lost != 0) {
			fail(w, 409, "Invalid opportunity or stage values")
			return
		}
		if (won != 0 || lost != 0) && in.Reason == "" {
			fail(w, 400, "A reason is required for a won or lost opportunity")
			return
		}
		status := "open"
		var wonReason, lossReason any = nil, nil
		if won != 0 {
			status = "won"
			wonReason = in.Reason
		}
		if lost != 0 {
			status = "lost"
			lossReason = in.Reason
		}
		weighted := (amount*probability + 50) / 100
		_, e = tx.Exec("UPDATE crm_opportunities SET stage_id=?,probability=?,weighted_amount=?,status=?,won_reason=?,loss_reason=? WHERE organization_id=? AND id=? AND stage_id=?", in.StageID, probability, weighted, status, wonReason, lossReason, id.OrganizationID, entity, previous)
		result = map[string]any{"status": status, "probability": probability, "weightedAmount": weighted}
	case "createActivity":
		entity = "activity_" + token()
		_, e = tx.Exec("INSERT INTO crm_activities(id,organization_id,activity_type,subject,due_date,owner_id) VALUES(?,?,?,?,?,?)", entity, id.OrganizationID, in.ActivityType, in.Subject, in.DueDate, id.UserID)
		result["activityId"] = entity
	case "completeActivity":
		entity = in.ActivityID
		var owner string
		var completed int
		e = tx.QueryRow("SELECT owner_id,completed FROM crm_activities WHERE organization_id=? AND id=?", id.OrganizationID, entity).Scan(&owner, &completed)
		if errors.Is(e, sql.ErrNoRows) {
			fail(w, 404, "Activity not found")
			return
		}
		if e != nil {
			fail(w, 503, "Cannot read activity")
			return
		}
		if g.Scope == "front" && owner != id.UserID {
			fail(w, 403, "Only the activity owner can complete this task")
			return
		}
		if completed == 0 {
			_, e = tx.Exec("UPDATE crm_activities SET completed=1,completed_at=CURRENT_TIMESTAMP WHERE organization_id=? AND id=? AND completed=0", id.OrganizationID, entity)
		}
		result["alreadyCompleted"] = completed != 0
	}
	if e != nil {
		fail(w, 503, "Cannot save CRM operation")
		return
	}
	encoded, _ := json.Marshal(result)
	_, e = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", "idem_"+token(), id.OrganizationID, in.Key, endpoint, hash, string(encoded))
	if e == nil {
		_, e = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,after_value,reason) VALUES(?,?,?,?,?,'crm',?,?,?)", "audit_"+token(), id.OrganizationID, id.UserID, g.Role, "crm."+in.Action, entity, string(encoded), in.Reason)
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
