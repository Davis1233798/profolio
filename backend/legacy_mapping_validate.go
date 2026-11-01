package main

import (
	"net/http"
	"strings"
)

type legacyMappingEntry struct {
	Source string   `json:"source"`
	Target string   `json:"target"`
	Sites  []string `json:"sites"`
}
type legacyMappingRequest struct {
	Entries []legacyMappingEntry `json:"entries"`
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
	if body(r, &input) != nil || len(input.Entries) == 0 || len(input.Entries) > 500 {
		fail(w, 400, "Invalid mapping entries")
		return
	}
	seen := map[string]bool{}
	for _, entry := range input.Entries {
		if strings.TrimSpace(entry.Source) == "" || len(entry.Source) > 256 || strings.TrimSpace(entry.Target) == "" || len(entry.Target) > 256 || len(entry.Sites) == 0 || len(entry.Sites) > len(sites) || seen[entry.Source] {
			fail(w, 400, "Invalid or duplicate mapping")
			return
		}
		seen[entry.Source] = true
		checked := map[string]bool{}
		for _, site := range entry.Sites {
			if !knownSite(site) || checked[site] {
				fail(w, 400, "Invalid or duplicate workspace")
				return
			}
			checked[site] = true
			var count int
			err := a.db.QueryRow(`SELECT count(*) FROM station_accounts a JOIN station_grants g ON g.user_id=a.user_id WHERE a.user_id=? AND a.organization_id=? AND a.disabled=0 AND g.site=? AND g.enabled=1`, entry.Target, id.OrganizationID, site).Scan(&count)
			if err != nil {
				fail(w, 500, "Unable to validate account grants")
				return
			}
			if count != 1 {
				fail(w, 400, "Destination account lacks an enabled workspace grant")
				return
			}
		}
	}
	ok(w, map[string]any{"valid": true, "validatedMappings": len(input.Entries), "notice": "Account grant validation only. Backup validation and import are not complete."})
}
