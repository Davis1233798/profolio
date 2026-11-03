package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
)

type diningTableRequest struct {
	Action        string `json:"action"`
	TableID       string `json:"tableId"`
	SessionID     string `json:"sessionId"`
	Guests        int    `json:"guests"`
	SplitCount    int    `json:"splitCount"`
	ExpectedTotal int64  `json:"expectedTotal"`
	Method        string `json:"method"`
	Key           string `json:"idempotencyKey"`
}

func (a *App) diningTable(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Use POST")
		return
	}
	if g.Role == "readonly" {
		fail(w, 403, "A write-enabled role is required")
		return
	}
	var in diningTableRequest
	if body(r, &in) != nil || len(in.Key) < 8 || len(in.Key) > 128 || len(in.TableID) > 256 || len(in.SessionID) > 256 || (in.Action != "open" && in.Action != "pay") {
		fail(w, 400, "Invalid table request")
		return
	}
	if in.Action == "open" && (in.TableID == "" || in.Guests < 1 || in.Guests > 100) {
		fail(w, 400, "Select a table and guest count")
		return
	}
	if in.Action == "pay" && (in.SessionID == "" || in.SplitCount < 1 || in.SplitCount > 20 || (in.Method != "cash" && in.Method != "mock_card")) {
		fail(w, 400, "Select a session, split count and payment method")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, 503, "Dining service unavailable")
		return
	}
	defer tx.Rollback()
	raw, _ := json.Marshal(in)
	hash := digest(id.UserID + "\x00" + string(raw))
	endpoint := "/station/dining/" + in.Action
	var priorHash, priorBody string
	e = tx.QueryRow("SELECT request_hash,response_body FROM idempotency_keys WHERE organization_id=? AND key=? AND endpoint=?", id.OrganizationID, in.Key, endpoint).Scan(&priorHash, &priorBody)
	if e == nil {
		if priorHash != hash {
			fail(w, 409, "Retry key already used")
			return
		}
		var v map[string]any
		if json.Unmarshal([]byte(priorBody), &v) != nil {
			fail(w, 500, "Invalid retry result")
			return
		}
		ok(w, v)
		return
	}
	if !errors.Is(e, sql.ErrNoRows) {
		fail(w, 503, "Cannot read retry state")
		return
	}
	result := map[string]any{}
	entity := ""
	if in.Action == "open" {
		var state string
		var capacity int
		e = tx.QueryRow("SELECT status,capacity FROM dining_tables WHERE organization_id=? AND id=?", id.OrganizationID, in.TableID).Scan(&state, &capacity)
		if errors.Is(e, sql.ErrNoRows) {
			fail(w, 404, "Table not found")
			return
		}
		if e != nil {
			fail(w, 503, "Cannot read table")
			return
		}
		if state != "vacant" || in.Guests > capacity {
			fail(w, 409, "Table unavailable or capacity exceeded")
			return
		}
		var active int
		if e = tx.QueryRow("SELECT count(*) FROM dining_table_sessions WHERE organization_id=? AND table_id=? AND status='active'", id.OrganizationID, in.TableID).Scan(&active); e != nil {
			fail(w, 503, "Cannot read sessions")
			return
		}
		if active > 0 {
			fail(w, 409, "Table already has an active session")
			return
		}
		entity = "session_" + token()
		_, e = tx.Exec("INSERT INTO dining_table_sessions(id,organization_id,table_id,session_token,guest_count,status) VALUES(?,?,?,?,?,'active')", entity, id.OrganizationID, in.TableID, token(), in.Guests)
		if e == nil {
			_, e = tx.Exec("UPDATE dining_tables SET status='occupied' WHERE organization_id=? AND id=? AND status='vacant'", id.OrganizationID, in.TableID)
		}
		result = map[string]any{"sessionId": entity}
	} else {
		var table string
		e = tx.QueryRow("SELECT table_id FROM dining_table_sessions WHERE organization_id=? AND id=? AND status='active'", id.OrganizationID, in.SessionID).Scan(&table)
		if errors.Is(e, sql.ErrNoRows) {
			fail(w, 409, "Session not found or already closed")
			return
		}
		if e != nil {
			fail(w, 503, "Cannot read session")
			return
		}
		var subtotal, rate int64
		e = tx.QueryRow("SELECT COALESCE(SUM(i.line_total),0) FROM dining_order_items i JOIN dining_orders o ON o.id=i.order_id AND o.organization_id=i.organization_id WHERE o.organization_id=? AND o.session_id=? AND o.status='placed' AND i.status!='cancelled'", id.OrganizationID, in.SessionID).Scan(&subtotal)
		if e == nil {
			e = tx.QueryRow("SELECT l.service_fee_rate FROM dining_tables t JOIN dining_locations l ON l.id=t.location_id AND l.organization_id=t.organization_id WHERE t.organization_id=? AND t.id=?", id.OrganizationID, table).Scan(&rate)
		}
		if e != nil {
			fail(w, 503, "Cannot calculate bill")
			return
		}
		if subtotal <= 0 || rate < 0 || rate > 100 {
			fail(w, 409, "No billable items or invalid service rate")
			return
		}
		fee := (subtotal*rate + 50) / 100
		total := subtotal + fee
		if in.ExpectedTotal != total {
			fail(w, 409, "Bill changed; refresh before collecting payment")
			return
		}
		if int64(in.SplitCount) > total {
			fail(w, 400, "Too many splits for the bill amount")
			return
		}
		entity = "bill_" + token()
		_, e = tx.Exec("INSERT INTO dining_bills(id,organization_id,session_id,subtotal,service_charge,final_amount,paid_amount,status) VALUES(?,?,?,?,?,?,?,'paid')", entity, id.OrganizationID, in.SessionID, subtotal, fee, total, total)
		for i := 0; e == nil && i < in.SplitCount; i++ {
			amount := total / int64(in.SplitCount)
			if int64(i) < total%int64(in.SplitCount) {
				amount++
			}
			_, e = tx.Exec("INSERT INTO dining_payments(id,organization_id,bill_id,amount,payment_method,split_index) VALUES(?,?,?,?,?,?)", "pay_"+token(), id.OrganizationID, entity, amount, in.Method, i+1)
		}
		if e == nil {
			_, e = tx.Exec("UPDATE dining_table_sessions SET status='closed',closed_at=CURRENT_TIMESTAMP WHERE organization_id=? AND id=? AND status='active'", id.OrganizationID, in.SessionID)
		}
		if e == nil {
			_, e = tx.Exec("UPDATE dining_tables SET status='vacant' WHERE organization_id=? AND id=?", id.OrganizationID, table)
		}
		if e == nil {
			_, e = tx.Exec("UPDATE dining_orders SET status='completed' WHERE organization_id=? AND session_id=? AND status='placed'", id.OrganizationID, in.SessionID)
		}
		result = map[string]any{"billId": entity, "subtotal": subtotal, "serviceCharge": fee, "total": total, "splits": in.SplitCount}
	}
	if e != nil {
		fail(w, 503, "Cannot save dining transaction")
		return
	}
	encoded, _ := json.Marshal(result)
	_, e = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", "idem_"+token(), id.OrganizationID, in.Key, endpoint, hash, string(encoded))
	if e == nil {
		_, e = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,after_value) VALUES(?,?,?,?,?,'dining',?,?)", "audit_"+token(), id.OrganizationID, id.UserID, g.Role, "dining."+in.Action, entity, string(encoded))
	}
	if e != nil {
		fail(w, 503, "Cannot record dining transaction")
		return
	}
	if tx.Commit() != nil {
		fail(w, 503, "Cannot commit dining transaction")
		return
	}
	ok(w, result)
}
