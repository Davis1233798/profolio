package main

import (
	"fmt"
	"strings"
)

// prepareLegacyRows constructs a separate, in-memory candidate. It never writes
// to the database and is not a complete backup or import validation.
func prepareLegacyRows(backup legacyBackupPreview, destination string, entries []legacyMappingEntry) (map[string][]map[string]any, error) {
	if !strings.HasPrefix(backup.OrganizationID, "org_") || !strings.HasPrefix(destination, "org_test_") || backup.Tables == nil {
		return nil, fmt.Errorf("invalid source or destination")
	}
	allowed := map[string]bool{}
	for _, table := range legacyBackupTables {
		allowed[table] = true
	}
	mapping := map[string]string{}
	for _, entry := range entries {
		if entry.Source == "" || entry.Target == "" || mapping[entry.Source] != "" {
			return nil, fmt.Errorf("invalid mapping")
		}
		mapping[entry.Source] = entry.Target
	}
	used := map[string]bool{}
	out := make(map[string][]map[string]any, len(backup.Tables))
	count := 0
	for table, rows := range backup.Tables {
		if table == "station_accounts" && rows != nil && len(rows) == 0 {
			continue
		}
		if !allowed[table] || rows == nil {
			return nil, fmt.Errorf("invalid backup table")
		}
		out[table] = make([]map[string]any, 0, len(rows))
		identity := map[string]bool{}
		for _, field := range legacyIdentityFields[table] {
			identity[field] = true
		}
		for _, row := range rows {
			count++
			if count > 10000 || row == nil || row["organizationId"] != backup.OrganizationID {
				return nil, fmt.Errorf("invalid backup row")
			}
			copyRow := make(map[string]any, len(row))
			for field, value := range row {
				if field == "organizationId" {
					copyRow[field] = destination
					continue
				}
				if identity[field] && value != nil {
					source, ok := value.(string)
					if !ok || source == "" {
						return nil, fmt.Errorf("invalid identity")
					}
					if table == "shop_inventory_reservations" && field == "sessionId" && !isLegacyDemoIdentity(source, backup.OrganizationID) {
						copyRow[field] = source
						continue
					}
					target := mapping[source]
					if target == "" {
						return nil, fmt.Errorf("missing identity mapping")
					}
					copyRow[field] = target
					used[source] = true
					continue
				}
				copyRow[field] = value
			}
			out[table] = append(out[table], copyRow)
		}
	}
	if len(used) != len(mapping) {
		return nil, fmt.Errorf("unused identity mapping")
	}
	return out, nil
}
