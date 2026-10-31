package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestCRMSupportConsentAndSLA(t *testing.T) {
	start, e := time.Parse(time.RFC3339, "2026-10-30T09:00:00Z")
	if e != nil {
		t.Fatal(e)
	}
	if got := crmSLADue(start, 2).Format(time.RFC3339); got != "2026-11-02T02:00:00Z" {
		t.Fatalf("weekend SLA %s", got)
	}
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	office := loginSite(t, a, "office@suite.test", space, "crm")
	front := loginSite(t, a, "front@suite.test", space, "crm")
	viewer := loginSite(t, a, "viewer@suite.test", space, "crm")
	other := loginSite(t, a, "admin@suite.test", token(), "crm")
	path := "/api/stations/crm/support"
	var account string
	if e := a.db.QueryRow("SELECT id FROM crm_accounts WHERE organization_id=? LIMIT 1", org).Scan(&account); e != nil {
		t.Fatal(e)
	}
	create := map[string]any{"action": "contact", "accountId": account, "name": "Example Contact", "email": "Contact@example.test", "idempotencyKey": "crm-contact-0001"}
	if w := request(a, "POST", path, create, front...); w.Code != 403 {
		t.Fatalf("front %d", w.Code)
	}
	if w := request(a, "POST", path, create, viewer...); w.Code != 403 {
		t.Fatalf("viewer %d", w.Code)
	}
	if w := request(a, "POST", path, create, other...); w.Code != 404 {
		t.Fatalf("foreign customer %d", w.Code)
	}
	w := request(a, "POST", path, create, office...)
	if w.Code != 200 {
		t.Fatalf("contact %d %s", w.Code, w.Body.String())
	}
	var v struct {
		Data struct {
			ContactID string `json:"contactId"`
		} `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &v)
	if w := request(a, "POST", path, create, office...); w.Code != 200 {
		t.Fatalf("retry %d", w.Code)
	}
	var allowed int
	a.db.QueryRow("SELECT marketing_email_allowed FROM crm_consents WHERE organization_id=? AND contact_id=?", org, v.Data.ContactID).Scan(&allowed)
	if allowed != 0 {
		t.Fatal("marketing consent must default to opt out")
	}
	duplicate := map[string]any{"action": "contact", "name": "Duplicate", "email": "CONTACT@example.test", "idempotencyKey": "crm-contact-0002"}
	if w := request(a, "POST", path, duplicate, office...); w.Code != 409 {
		t.Fatalf("duplicate %d", w.Code)
	}
	optin := map[string]any{"action": "contact", "name": "Opted In", "email": "opted@example.test", "marketingConsent": true, "idempotencyKey": "crm-contact-0003"}
	w = request(a, "POST", path, optin, office...)
	if w.Code != 200 {
		t.Fatalf("opt in %d", w.Code)
	}
	json.Unmarshal(w.Body.Bytes(), &v)
	back := request(a, "GET", "/api/stations/crm/data?view=back", nil, office...)
	var snapshot struct {
		Data struct {
			Recipients []struct {
				Email string `json:"email"`
			} `json:"marketingRecipients"`
		} `json:"data"`
	}
	if e := json.Unmarshal(back.Body.Bytes(), &snapshot); e != nil {
		t.Fatal(e)
	}
	found := false
	for _, recipient := range snapshot.Data.Recipients {
		if recipient.Email == "opted@example.test" {
			found = true
		}
	}
	if back.Code != 200 || !found {
		t.Fatalf("missing opted in recipient %d", back.Code)
	}
	frontData := request(a, "GET", "/api/stations/crm/data?view=front", nil, front...)
	if frontData.Code != 200 || strings.Contains(frontData.Body.String(), "opted@example.test") {
		t.Fatalf("front data exposed contact email: %d", frontData.Code)
	}
	revoke := map[string]any{"action": "revoke", "contactId": v.Data.ContactID, "idempotencyKey": "crm-revoke-0001"}
	if w := request(a, "POST", path, revoke, office...); w.Code != 200 {
		t.Fatalf("revoke %d", w.Code)
	}
	a.db.QueryRow("SELECT marketing_email_allowed FROM crm_consents WHERE organization_id=? AND contact_id=?", org, v.Data.ContactID).Scan(&allowed)
	if allowed != 0 {
		t.Fatal("consent was not revoked")
	}
	var recipients int
	a.db.QueryRow("SELECT count(*) FROM crm_consents WHERE organization_id=? AND contact_id=? AND marketing_email_allowed=1", org, v.Data.ContactID).Scan(&recipients)
	if recipients != 0 {
		t.Fatal("revoked contact in marketing recipients")
	}
	back = request(a, "GET", "/api/stations/crm/data?view=back", nil, office...)
	snapshot.Data.Recipients = nil
	if e := json.Unmarshal(back.Body.Bytes(), &snapshot); e != nil {
		t.Fatal(e)
	}
	for _, recipient := range snapshot.Data.Recipients {
		if recipient.Email == "opted@example.test" {
			t.Fatal("revoked email returned by recipient API")
		}
	}
	ticket := map[string]any{"action": "ticket", "accountId": account, "subject": "Example issue", "priority": "high", "slaHours": 24, "idempotencyKey": "crm-ticket-0001"}
	w = request(a, "POST", path, ticket, office...)
	if w.Code != 200 {
		t.Fatalf("ticket %d %s", w.Code, w.Body.String())
	}
	var tkt struct {
		Data struct {
			ID  string `json:"ticketId"`
			Due string `json:"dueAt"`
		} `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &tkt)
	var created string
	if e := a.db.QueryRow("SELECT created_at FROM crm_tickets WHERE organization_id=? AND id=?", org, tkt.Data.ID).Scan(&created); e != nil {
		t.Fatal(e)
	}
	createdAt, _ := time.Parse(time.RFC3339, created)
	if tkt.Data.Due != crmSLADue(createdAt, 24).Format(time.RFC3339) {
		t.Fatalf("ticket due %s", tkt.Data.Due)
	}
	ticketData := request(a, "GET", "/api/stations/crm/data?view=front", nil, front...)
	var ticketSnapshot struct {
		Data struct {
			Tickets []struct {
				ID       string `json:"id"`
				Due      string `json:"dueAt"`
				Breached bool   `json:"isSlaBreached"`
			} `json:"tickets"`
		} `json:"data"`
	}
	if e := json.Unmarshal(ticketData.Body.Bytes(), &ticketSnapshot); e != nil {
		t.Fatal(e)
	}
	foundTicket := false
	for _, ticket := range ticketSnapshot.Data.Tickets {
		if ticket.ID == tkt.Data.ID {
			foundTicket = true
			if ticket.Due != tkt.Data.Due || ticket.Breached {
				t.Fatalf("incorrect live SLA %+v", ticket)
			}
		}
	}
	if !foundTicket {
		t.Fatal("ticket missing from front data")
	}
	if w := request(a, "POST", path, ticket, office...); w.Code != 200 {
		t.Fatalf("ticket retry %d", w.Code)
	}
}
