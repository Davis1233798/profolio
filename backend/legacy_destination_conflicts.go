package main

import (
	"database/sql"
	"fmt"
	"strings"
)

// Both sql.DB and sql.Tx satisfy this interface. Staging checks are advisory;
// the import path must repeat them inside its write transaction.
type legacyConflictQuery interface {
	QueryRow(query string, args ...any) *sql.Row
}

func checkLegacyDestinationConflicts(db legacyConflictQuery, organization string, data map[string][]map[string]any) error {
	for _, table := range legacyBackupTables {
		rows := data[table]
		for start := 0; start < len(rows); start += 400 {
			end := start + 400
			if end > len(rows) {
				end = len(rows)
			}
			args := []any{}
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
			// IDs are global primary keys, so a row belonging to any tenant can
			// prevent insertion. Do not disclose the conflicting tenant or ID.
			query := "SELECT count(*) FROM \"" + table + "\" WHERE id IN (" + strings.Join(marks, ",") + ")"
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
