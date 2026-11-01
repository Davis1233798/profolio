package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

var errLegacyGrantLookup = errors.New("unable to validate account grants")

type legacyMappingEntry struct {
	Source string `json:"source"`
	Target string `json:"target"`
}
type legacyMappingRequest struct {
	Entries []legacyMappingEntry `json:"entries"`
	Backup  legacyBackupPreview  `json:"backup"`
	Stage   bool                 `json:"stage"`
}

// validateLegacyGrant checks can run on either a database or the import's
// transaction, so the final write can recheck grants atomically.
func validateLegacyGrant(q legacyConflictQuery, organization, user, site string, needsBackOffice bool) (bool, error) {
	var count int
	err := q.QueryRow(`SELECT count(*) FROM station_accounts a JOIN station_grants g ON g.user_id=a.user_id WHERE a.user_id=? AND a.organization_id=? AND a.disabled=0 AND g.site=? AND g.enabled=1 AND (?=0 OR g.scope='back')`, user, organization, site, needsBackOffice).Scan(&count)
	return count == 1, err
}

func validateLegacyMappings(q legacyConflictQuery, organization string, backup legacyBackupPreview, entries []legacyMappingEntry) error {
	required := map[string]map[string]bool{}
	total := 0
	for table, rows := range backup.Tables {
		if rows == nil {
			return fmt.Errorf("Invalid backup table")
		}
		total += len(rows)
		if total > 10000 {
			return fmt.Errorf("Backup exceeds row limit")
		}
		fields := legacyIdentityFields[table]
		site := strings.SplitN(table, "_", 2)[0]
		for _, row := range rows {
			if row["organizationId"] != backup.OrganizationID {
				return fmt.Errorf("Backup contains another organization")
			}
			for _, field := range fields {
				rawValue, present := row[field]
				if !present || rawValue == nil {
					requiredIdentity := table == "mes_production_reports" || table == "crm_accounts" || table == "crm_opportunities" || table == "crm_activities" || table == "pos_shifts" || table == "pos_sales" || table == "shop_reviews" || table == "shop_inventory_reservations"
					if requiredIdentity {
						return fmt.Errorf("Required legacy identity is missing")
					}
					continue
				}
				value, ok := rawValue.(string)
				if !ok || value == "" {
					return fmt.Errorf("Invalid legacy identity reference")
				}
				if table == "shop_inventory_reservations" && field == "sessionId" && !isLegacyDemoIdentity(value, backup.OrganizationID) {
					continue
				}
				if required[value] == nil {
					required[value] = map[string]bool{}
				}
				// Accounts and opportunities are only exposed in the CRM back office.
				required[value][site] = required[value][site] || table == "crm_accounts" || table == "crm_opportunities" || table == "crm_leads"
			}
		}
	}
	if len(required) != len(entries) {
		return fmt.Errorf("Mappings must cover every referenced identity")
	}
	seen := map[string]bool{}
	for _, entry := range entries {
		if strings.TrimSpace(entry.Source) == "" || len(entry.Source) > 256 || strings.TrimSpace(entry.Target) == "" || len(entry.Target) > 256 || required[entry.Source] == nil || seen[entry.Source] {
			return fmt.Errorf("Invalid or duplicate mapping")
		}
		seen[entry.Source] = true
		for site, needsBackOffice := range required[entry.Source] {
			valid, err := validateLegacyGrant(q, organization, entry.Target, site, needsBackOffice)
			if err != nil {
				return errLegacyGrantLookup
			}
			if !valid {
				return fmt.Errorf("Destination account lacks a required enabled workspace grant or scope")
			}
		}
	}
	return nil
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
	if err := validateLegacyMappings(a.db, id.OrganizationID, input.Backup, input.Entries); err != nil {
		if errors.Is(err, errLegacyGrantLookup) {
			fail(w, 500, "Unable to validate account grants")
			return
		}
		fail(w, 400, err.Error())
		return
	}
	prepared, err := prepareLegacyRows(input.Backup, id.OrganizationID, input.Entries)
	if err != nil {
		fail(w, 400, "Unable to prepare backup identities")
		return
	}
	preparedRows := 0
	for _, rows := range prepared {
		preparedRows += len(rows)
	}
	result := map[string]any{"valid": true, "validatedMappings": len(input.Entries), "preparedRows": preparedRows, "staged": false, "notice": "Referenced account grants validated and candidate rows prepared in memory. Full backup validation and import are not complete."}
	if input.Stage {
		if conflictErr := checkLegacyDestinationConflicts(a.db, id.OrganizationID, prepared); conflictErr != nil {
			fail(w, 409, conflictErr.Error())
			return
		}
		count, stageErr := stageLegacyRows(prepared)
		if stageErr != nil {
			fail(w, 400, "Staging rejected: "+stageErr.Error())
			return
		}
		result["staged"] = true
		result["stagedRows"] = count
		result["notice"] = "Rows passed isolated schema, known-link and trigger staging. Destination and business validation and import are not complete."
	}
	ok(w, result)
}
