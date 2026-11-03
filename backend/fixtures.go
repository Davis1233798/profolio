package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// The source fixture was exported from the old Node demo. Translate only
// account-reference columns, never arbitrary business text or opaque sessions.
var fixtureIdentityColumns = map[string]map[string]bool{
	"mes_production_reports": {"operator_id": true},
	"crm_leads":              {"assigned_to": true}, "crm_accounts": {"owner_id": true},
	"crm_opportunities": {"owner_id": true}, "crm_activities": {"owner_id": true},
	"pos_shifts": {"cashier_id": true}, "pos_sales": {"cashier_id": true}, "pos_held_carts": {"locked_by": true},
	"shop_carts": {"user_id": true}, "shop_orders": {"user_id": true}, "shop_reviews": {"user_id": true},
	"shop_inventory_reservations": {"session_id": true},
}

func seedFixtures(tx *sql.Tx, org string) error {
	b, e := migrations.ReadFile("migrations/fixtures.json")
	if e != nil {
		return e
	}
	var fixtures map[string][]map[string]any
	if e = json.Unmarshal(b, &fixtures); e != nil {
		return e
	}
	tables := []string{}
	for t := range fixtures {
		tables = append(tables, t)
	}
	sort.Strings(tables)
	for _, table := range tables {
		for _, row := range fixtures[table] {
			keys := []string{}
			for k := range row {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			args := []any{}
			marks := []string{}
			for _, k := range keys {
				v := row[k]
				if s, yes := v.(string); yes {
					v = strings.ReplaceAll(s, "org_go_fixture", org)
					if fixtureIdentityColumns[table][k] {
						for legacy, current := range map[string]string{"admin": "admin", "op": "front", "ro": "viewer"} {
							if s == "usr_org_go_fixture_"+legacy {
								v = org + "_" + current
								break
							}
						}
					}
				}
				args = append(args, v)
				marks = append(marks, "?")
			}
			q := fmt.Sprintf("INSERT OR IGNORE INTO %s (%s) VALUES (%s)", table, strings.Join(keys, ","), strings.Join(marks, ","))
			if _, e = tx.Exec(q, args...); e != nil {
				return fmt.Errorf("fixture %s: %w", table, e)
			}
		}
	}
	return nil
}
