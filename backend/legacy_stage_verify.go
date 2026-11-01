package main

import (
	"database/sql"
	"fmt"
)

// verifyLegacyStoredRows compares every supplied field after database insertion.
// It can also verify inserted rows within a destination transaction.
func verifyLegacyStoredRows(tx *sql.Tx, data map[string][]map[string]any) error {
	for _, table := range legacyBackupTables {
		for _, source := range data[table] {
			id, idOK := source["id"].(string)
			org, orgOK := source["organizationId"].(string)
			if !idOK || id == "" || !orgOK || org == "" {
				return fmt.Errorf("invalid verification identity in %s", table)
			}
			rows, err := tx.Query("SELECT * FROM \""+table+"\" WHERE organization_id=? AND id=?", org, id)
			if err != nil {
				return fmt.Errorf("cannot verify %s", table)
			}
			columns, err := rows.Columns()
			if err != nil {
				rows.Close()
				return fmt.Errorf("cannot verify %s", table)
			}
			if !rows.Next() {
				rows.Close()
				return fmt.Errorf("missing verified row in %s", table)
			}
			values := make([]any, len(columns))
			dest := make([]any, len(columns))
			for i := range values {
				dest[i] = &values[i]
			}
			err = rows.Scan(dest...)
			if err == nil {
				err = rows.Err()
			}
			rows.Close()
			if err != nil || len(source) != len(columns) {
				return fmt.Errorf("content mismatch in %s", table)
			}
			for i, column := range columns {
				key := camel(column)
				expected, found := source[key]
				if !found || !legacyValueEqual(expected, values[i]) {
					return fmt.Errorf("content mismatch in %s.%s", table, key)
				}
			}
		}
	}
	return nil
}

func legacyValueEqual(expected, actual any) bool {
	switch v := expected.(type) {
	case nil:
		return actual == nil
	case string:
		value, ok := actual.(string)
		return ok && value == v
	case bool:
		value, ok := actual.(int64)
		return ok && ((v && value == 1) || (!v && value == 0))
	case float64:
		value, ok := actual.(int64)
		return ok && float64(value) == v
	default:
		return false
	}
}
