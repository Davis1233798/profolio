package main

import (
	"database/sql"
	"fmt"
	"strings"
)

// checkLegacyDestinationConflicts is advisory. A final import must repeat all
// checks inside its write transaction; database state can change after staging.
func checkLegacyDestinationConflicts(db *sql.DB, organization string, data map[string][]map[string]any) error {
	for _, table := range legacyBackupTables {
		rows := data[table]
		for start := 0; start < len(rows); start += 400 {
			end := start + 400
			if end > len(rows) {
				end = len(rows)
			}
			args := []any{organization}
			marks := make([]string, 0, end-start)
			for _, row := range rows[start:end] {
				id, ok := row["id"].(string)
				if !ok || id == "" {
					return fmt.Errorf("invalid ID in %s", table)
				}
				args = append(args, id)
				marks = append(marks, "?")
			}
			var count int
			query := "SELECT count(*) FROM \"" + table + "\" WHERE organization_id=? AND id IN (" + strings.Join(marks, ",") + ")"
			if err := db.QueryRow(query, args...).Scan(&count); err != nil {
				return fmt.Errorf("cannot inspect destination table %s", table)
			}
			if count != 0 {
				return fmt.Errorf("destination contains conflicting IDs in %s", table)
			}
		}
	}
	return nil
}
