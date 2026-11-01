package main

import (
	"fmt"
	"math"
	"strings"
)

// stageLegacyRows uses a fresh ephemeral database with the destination schema
// and triggers. It does not establish complete business or destination safety.
func stageLegacyRows(data map[string][]map[string]any) (int, error) {
	if len(data) != len(legacyBackupTables) {
		return 0, fmt.Errorf("incomplete business table manifest")
	}
	db, err := openDB(":memory:")
	if err != nil {
		return 0, fmt.Errorf("cannot create staging database")
	}
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		return 0, fmt.Errorf("cannot start staging transaction")
	}
	defer tx.Rollback()
	total := 0
	for _, table := range legacyBackupTables {
		rows, exists := data[table]
		if !exists || rows == nil {
			return 0, fmt.Errorf("missing table %s", table)
		}
		info, err := tx.Query("PRAGMA table_info(\"" + table + "\")")
		if err != nil {
			return 0, fmt.Errorf("cannot inspect table %s", table)
		}
		type column struct {
			name, typ string
			required  bool
		}
		var columns []column
		for info.Next() {
			var cid, notnull, pk int
			var name, typ string
			var def any
			if err = info.Scan(&cid, &name, &typ, &notnull, &def, &pk); err != nil {
				break
			}
			columns = append(columns, column{name, strings.ToUpper(typ), notnull != 0 || pk != 0})
		}
		if err == nil {
			err = info.Err()
		}
		info.Close()
		if err != nil || len(columns) == 0 {
			return 0, fmt.Errorf("cannot inspect table %s", table)
		}
		names, marks := make([]string, 0, len(columns)), make([]string, 0, len(columns))
		for _, c := range columns {
			names = append(names, "\""+c.name+"\"")
			marks = append(marks, "?")
		}
		query := "INSERT INTO \"" + table + "\" (" + strings.Join(names, ",") + ") VALUES (" + strings.Join(marks, ",") + ")"
		for _, row := range rows {
			if len(row) != len(columns) {
				return 0, fmt.Errorf("incomplete or unknown fields in %s", table)
			}
			values := make([]any, 0, len(columns))
			for _, c := range columns {
				key := camel(c.name)
				v, ok := row[key]
				if !ok || (v == nil && c.required) {
					return 0, fmt.Errorf("invalid field %s.%s", table, key)
				}
				if v != nil {
					valid := false
					if legacyBooleanFields[table+"."+key] {
						_, valid = v.(bool)
					} else if strings.Contains(c.typ, "INT") {
						n, yes := v.(float64)
						valid = yes && math.Trunc(n) == n && math.Abs(n) <= 9007199254740991
					} else if strings.Contains(c.typ, "TEXT") || strings.Contains(c.typ, "CHAR") || strings.Contains(c.typ, "CLOB") {
						_, valid = v.(string)
					}
					if !valid {
						return 0, fmt.Errorf("invalid field %s.%s", table, key)
					}
				}
				values = append(values, v)
			}
			if _, err = tx.Exec(query, values...); err != nil {
				return 0, fmt.Errorf("staging constraint failed in %s", table)
			}
			total++
		}
	}
	return total, nil
}
