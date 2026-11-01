package main

import "net/http"

// legacyMappingAccounts exposes only the signed-in organization's account grants
// and requires administrative authority in every station affected by migration.
func (a *App) legacyMappingAccounts(w http.ResponseWriter, r *http.Request, id *Identity) {
	if r.Method != http.MethodGet {
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
	rows, err := queryMaps(a.db, `SELECT a.user_id,a.email,u.display_name,a.disabled,g.site,g.role,g.scope,g.enabled FROM station_accounts a JOIN users u ON u.id=a.user_id LEFT JOIN station_grants g ON g.user_id=a.user_id WHERE a.organization_id=? ORDER BY a.user_id,g.site`, id.OrganizationID)
	if err != nil {
		fail(w, 500, "Unable to read migration accounts")
		return
	}
	ok(w, rows)
}
