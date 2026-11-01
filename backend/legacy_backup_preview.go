package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

type legacyBackupPreview struct {
	Format         string                      `json:"format"`
	OrganizationID string                      `json:"organizationId"`
	ExportedAt     string                      `json:"exportedAt"`
	Tables         map[string][]map[string]any `json:"tables"`
}

// legacyBackupPreviewAPI performs a read-only preliminary inspection, not an import
// or a full consistency validation. No source rows are returned to the client.
func (a *App) legacyBackupPreviewAPI(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Method not allowed")
		return
	}
	if g.Role != "admin" || g.Scope != "back" {
		fail(w, 403, "Administrator access required")
		return
	}
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		fail(w, 415, "A JSON backup is required")
		return
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, 5000001))
	if err != nil || len(b) > 5000000 {
		fail(w, 413, "Backup exceeds the 5 MB limit")
		return
	}
	var backup legacyBackupPreview
	if err = json.Unmarshal(b, &backup); err != nil || backup.Format != "business-suite/v1" || !strings.HasPrefix(backup.OrganizationID, "org_") || backup.ExportedAt == "" || backup.Tables == nil {
		fail(w, 400, "Invalid legacy backup envelope")
		return
	}
	counts := map[string]int{}
	total := 0
	for name, rows := range backup.Tables {
		if !(strings.HasPrefix(name, "mes_") || strings.HasPrefix(name, "erp_") || strings.HasPrefix(name, "pos_") || strings.HasPrefix(name, "crm_") || strings.HasPrefix(name, "dining_") || strings.HasPrefix(name, "shop_")) {
			fail(w, 400, "Unknown backup table")
			return
		}
		counts[name] = len(rows)
		total += len(rows)
		if total > 10000 {
			fail(w, 400, "Backup exceeds the 10,000 row limit")
			return
		}
		for _, row := range rows {
			if row["organizationId"] != backup.OrganizationID {
				fail(w, 400, "Backup contains a row from another organization")
				return
			}
		}
	}
	ok(w, map[string]any{"sourceOrganization": backup.OrganizationID, "destinationOrganization": id.OrganizationID, "exportedAt": backup.ExportedAt, "rowCount": total, "tableCounts": counts, "readyToImport": false, "notice": "Preliminary inspection only; schema, references, identities and business rules have not been validated. No data was imported."})
}
