package main

import (
	"database/sql"
	"fmt"
)

// verifyLegacyStoredRows compares every supplied field after database insertion.
// It is used in isolated staging; actual import must independently verify its transaction.
func verifyLegacyStoredRows(tx *sql.Tx, data map[string][]map[string]any) error {
	for _, table := range legacyBackupTables {
		rows, err := tx.Query("SELECT * FROM \"" + table + "\"")
		if err != nil {
			return fmt.Errorf("cannot verify %s", table)
		}
		columns, err := rows.Columns()
		if err != nil {
			rows.Close()
			return fmt.Errorf("cannot verify %s", table)
		}
		expected := map[string]map[string]any{}
		for _, row := range data[table] {
			id, _ := row["id"].(string)
			expected[id] = row
		}
		for rows.Next() {
			values := make([]any, len(columns))
			dest := make([]any, len(columns))
			for i := range values {
				dest[i] = &values[i]
			}
			if err = rows.Scan(dest...); err != nil {
				break
			}
			actual := map[string]any{}
			for i, column := range columns {
				actual[camel(column)] = values[i]
			}
			id, _ := actual["id"].(string)
			source, ok := expected[id]
			if !ok || len(source) != len(actual) {
				rows.Close()
				return fmt.Errorf("staging content mismatch in %s", table)
			}
			for key, value := range source {
				stored, found := actual[key]
				if !found || !legacyValueEqual(value, stored) {
					rows.Close()
					return fmt.Errorf("staging content mismatch in %s.%s", table, key)
				}
			}
			delete(expected, id)
		}
		if err == nil {
			err = rows.Err()
		}
		rows.Close()
		if err != nil || len(expected) != 0 {
			return fmt.Errorf("cannot verify staged rows in %s", table)
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
