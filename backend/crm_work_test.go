package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCRMStageAndActivities(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	admin := loginSite(t, a, "admin@suite.test", space, "crm")
	staff := loginSite(t, a, "front@suite.test", space, "crm")
	viewer := loginSite(t, a, "viewer@suite.test", space, "crm")
	other := loginSite(t, a, "admin@suite.test", token(), "crm")
	path := "/api/stations/crm/work"
	var opp, previous, won string
	var amount, probability int64
	if e := a.db.QueryRow("SELECT id,stage_id,amount FROM crm_opportunities WHERE organization_id=? LIMIT 1", org).Scan(&opp, &previous, &amount); e != nil {
		t.Fatal(e)
	}
	if e := a.db.QueryRow("SELECT id,probability FROM crm_stages WHERE organization_id=? AND is_won=1 LIMIT 1", org).Scan(&won, &probability); e != nil {
		t.Fatal(e)
	}
	stage := map[string]any{"action": "stage", "opportunityId": opp, "expectedStage": previous, "stageId": won, "reason": "Contract signed", "idempotencyKey": "crm-stage-00001"}
	if w := request(a, "POST", path, stage, viewer...); w.Code != 403 {
		t.Fatalf("readonly %d", w.Code)
	}
	if w := request(a, "POST", path, stage, staff...); w.Code != 403 {
		t.Fatalf("front %d", w.Code)
	}
	if w := request(a, "POST", path, stage, other...); w.Code != 404 {
		t.Fatalf("foreign %d", w.Code)
	}
	missing := map[string]any{"action": "stage", "opportunityId": opp, "expectedStage": previous, "stageId": won, "idempotencyKey": "crm-stage-00002"}
	if w := request(a, "POST", path, missing, admin...); w.Code != 400 {
		t.Fatalf("reason required %d", w.Code)
	}
	if w := request(a, "POST", path, stage, admin...); w.Code != 200 {
		t.Fatalf("stage %d %s", w.Code, w.Body.String())
	}
	if w := request(a, "POST", path, stage, admin...); w.Code != 200 {
		t.Fatalf("replay %d", w.Code)
	}
	stale := map[string]any{"action": "stage", "opportunityId": opp, "expectedStage": previous, "stageId": won, "reason": "Contract signed", "idempotencyKey": "crm-stage-00003"}
	if w := request(a, "POST", path, stale, admin...); w.Code != 409 {
		t.Fatalf("stale update %d", w.Code)
	}
	var status, reason string
	var weighted int64
	a.db.QueryRow("SELECT status,won_reason,weighted_amount FROM crm_opportunities WHERE organization_id=? AND id=?", org, opp).Scan(&status, &reason, &weighted)
	if status != "won" || reason != "Contract signed" || weighted != (amount*probability+50)/100 {
		t.Fatalf("incorrect stage %s %s %d", status, reason, weighted)
	}
	create := map[string]any{"action": "createActivity", "subject": "Follow up", "dueDate": "2035-10-01T10:00:00Z", "activityType": "call", "idempotencyKey": "crm-activity-001"}
	w := request(a, "POST", path, create, admin...)
	if w.Code != 200 {
		t.Fatalf("activity %d %s", w.Code, w.Body.String())
	}
	var value struct {
		Data struct {
			ID string `json:"activityId"`
		} `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &value)
	frontData := request(a, "GET", "/api/stations/crm/data?view=front", nil, staff...)
	if frontData.Code != 200 || strings.Contains(frontData.Body.String(), value.Data.ID) {
		t.Fatalf("another user's activity was exposed in front data: %d", frontData.Code)
	}
	complete := map[string]any{"action": "completeActivity", "activityId": value.Data.ID, "idempotencyKey": "crm-complete-001"}
	if w := request(a, "POST", path, complete, staff...); w.Code != 403 {
		t.Fatalf("other owner %d", w.Code)
	}
	if w := request(a, "POST", path, complete, admin...); w.Code != 200 {
		t.Fatalf("complete %d", w.Code)
	}
	if w := request(a, "POST", path, complete, admin...); w.Code != 200 {
		t.Fatalf("complete replay %d", w.Code)
	}
	var completed int
	var completedAt string
	if e := a.db.QueryRow("SELECT completed,completed_at FROM crm_activities WHERE organization_id=? AND id=?", org, value.Data.ID).Scan(&completed, &completedAt); e != nil || completed != 1 || completedAt == "" {
		t.Fatalf("completion %d %s %v", completed, completedAt, e)
	}
}
