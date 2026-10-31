package main

import (
	"database/sql"
	"errors"
	"net/http"
)

func (a *App) diningBusiness(w http.ResponseWriter, r *http.Request, id *Identity, grant *Grant) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Use POST")
		return
	}
	if grant.Role == "readonly" {
		fail(w, 403, "A write-enabled role is required")
		return
	}
	var in struct {
		TicketID string `json:"ticketId"`
		Expected string `json:"expected"`
		Next     string `json:"next"`
	}
	if body(r, &in) != nil || len(in.TicketID) == 0 || len(in.TicketID) > 256 {
		fail(w, 400, "Select a kitchen ticket")
		return
	}
	next := map[string]string{"received": "cooking", "cooking": "done", "done": "served"}
	itemStatus := map[string]string{"cooking": "preparing", "done": "ready", "served": "served"}
	if next[in.Expected] == "" || next[in.Expected] != in.Next {
		fail(w, 400, "Invalid kitchen transition")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, 503, "Kitchen unavailable")
		return
	}
	defer tx.Rollback()
	var state, item, order, itemState string
	e = tx.QueryRow("SELECT k.status,k.order_item_id,k.order_id,i.status FROM dining_kitchen_tickets k JOIN dining_order_items i ON i.id=k.order_item_id AND i.organization_id=k.organization_id WHERE k.id=? AND k.organization_id=?", in.TicketID, id.OrganizationID).Scan(&state, &item, &order, &itemState)
	if errors.Is(e, sql.ErrNoRows) {
		fail(w, 404, "Kitchen ticket not found")
		return
	}
	if e != nil {
		fail(w, 503, "Cannot read ticket")
		return
	}
	if state != in.Expected || itemState == "cancelled" {
		fail(w, 409, "Ticket changed or item was cancelled; refresh")
		return
	}
	result, e := tx.Exec("UPDATE dining_kitchen_tickets SET status=? WHERE id=? AND organization_id=? AND status=?", in.Next, in.TicketID, id.OrganizationID, in.Expected)
	if e != nil {
		fail(w, 503, "Cannot update ticket")
		return
	}
	n, e := result.RowsAffected()
	if e != nil || n != 1 {
		fail(w, 409, "Ticket changed; refresh")
		return
	}
	_, e = tx.Exec("UPDATE dining_order_items SET status=? WHERE id=? AND organization_id=? AND status!='cancelled'", itemStatus[in.Next], item, id.OrganizationID)
	if e == nil && in.Next == "served" {
		_, e = tx.Exec("UPDATE dining_orders SET status='completed' WHERE id=? AND organization_id=? AND order_type='takeout' AND NOT EXISTS (SELECT 1 FROM dining_kitchen_tickets WHERE organization_id=? AND order_id=? AND status!='served')", order, id.OrganizationID, id.OrganizationID, order)
	}
	if e == nil {
		_, e = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,before_value,after_value) VALUES(?,?,?,?,'dining.kitchen','dining_ticket',?,?,?)", "audit_"+token(), id.OrganizationID, id.UserID, grant.Role, in.TicketID, in.Expected, in.Next)
	}
	if e != nil {
		fail(w, 503, "Cannot save kitchen transition")
		return
	}
	if tx.Commit() != nil {
		fail(w, 503, "Cannot commit kitchen transition")
		return
	}
	ok(w, map[string]any{"status": in.Next})
}
