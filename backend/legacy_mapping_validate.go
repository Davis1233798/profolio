package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

type legacyMappingEntry struct {
	Source string `json:"source"`
	Target string `json:"target"`
}
type legacyMappingRequest struct {
	Entries []legacyMappingEntry `json:"entries"`
	Backup  legacyBackupPreview  `json:"backup"`
}

// Validate mappings against current account and station grants without writing data.
func (a *App) legacyMappingValidate(w http.ResponseWriter, r *http.Request, id *Identity) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Method not allowed")
		return
	}
	for _, site := range sites {
		g := id.grant(site)
		if g == nil || g.Role != "admin" || g.Scope != "back" {
			fail(w, 403, "Administrator access to every workspace is required")
			return
		}
	}
	var input legacyMappingRequest
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		fail(w, 415, "A JSON request is required")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 5000001))
	if err != nil || len(raw) > 5000000 || json.Unmarshal(raw, &input) != nil || len(input.Entries) > 500 || input.Backup.Format != "business-suite/v1" || !strings.HasPrefix(input.Backup.OrganizationID, "org_") || input.Backup.Tables == nil || len(input.Backup.Tables) > 200 {
		fail(w, 400, "Invalid mapping request")
		return
	}
	required := map[string]map[string]bool{}
	total := 0
	for table, rows := range input.Backup.Tables {
		if rows == nil {
			fail(w, 400, "Invalid backup table")
			return
		}
		total += len(rows)
		if total > 10000 {
			fail(w, 400, "Backup exceeds row limit")
			return
		}
		fields := legacyIdentityFields[table]
		site := strings.SplitN(table, "_", 2)[0]
		for _, row := range rows {
			if row["organizationId"] != input.Backup.OrganizationID {
				fail(w, 400, "Backup contains another organization")
				return
			}
			for _, field := range fields {
				rawValue, present := row[field]
				if !present || rawValue == nil {
					requiredIdentity := table == "crm_accounts" || table == "crm_opportunities" || table == "crm_activities" || table == "pos_shifts" || table == "pos_sales" || table == "shop_reviews"
					if requiredIdentity {
						fail(w, 400, "Required legacy identity is missing")
						return
					}
					continue
				}
				value, ok := rawValue.(string)
				if !ok || value == "" {
					fail(w, 400, "Invalid legacy identity reference")
					return
				}
				if required[value] == nil {
					required[value] = map[string]bool{}
				}
				// Accounts and opportunities are only exposed in the CRM back office.
				required[value][site] = required[value][site] || table == "crm_accounts" || table == "crm_opportunities"
			}
		}
	}
	if len(required) != len(input.Entries) {
		fail(w, 400, "Mappings must cover every referenced identity")
		return
	}
	seen := map[string]bool{}
	for _, entry := range input.Entries {
		if strings.TrimSpace(entry.Source) == "" || len(entry.Source) > 256 || strings.TrimSpace(entry.Target) == "" || len(entry.Target) > 256 || required[entry.Source] == nil || seen[entry.Source] {
			fail(w, 400, "Invalid or duplicate mapping")
			return
		}
		seen[entry.Source] = true
		for site, needsBackOffice := range required[entry.Source] {
			var count int
			err := a.db.QueryRow(`SELECT count(*) FROM station_accounts a JOIN station_grants g ON g.user_id=a.user_id WHERE a.user_id=? AND a.organization_id=? AND a.disabled=0 AND g.site=? AND g.enabled=1 AND (?=0 OR g.scope='back')`, entry.Target, id.OrganizationID, site, needsBackOffice).Scan(&count)
			if err != nil {
				fail(w, 500, "Unable to validate account grants")
				return
			}
			if count != 1 {
				fail(w, 400, "Destination account lacks a required enabled workspace grant or scope")
				return
			}
		}
	}
	ok(w, map[string]any{"valid": true, "validatedMappings": len(input.Entries), "notice": "Referenced account grants validated. Full backup validation and import are not complete."})
}
