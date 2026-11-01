package main

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"
)

var legacyIdentityFields = map[string][]string{
	"crm_accounts": {"ownerId"}, "crm_opportunities": {"ownerId"}, "crm_activities": {"ownerId"},
	"pos_shifts": {"cashierId"}, "pos_sales": {"cashierId"}, "pos_held_carts": {"lockedBy"},
	"shop_carts": {"userId"}, "shop_orders": {"userId"}, "shop_reviews": {"userId"}, "shop_inventory_reservations": {"sessionId"},
}

// Legacy checkout accepts either a demo account ID or an opaque client session.
func isLegacyDemoIdentity(value, organization string) bool {
	for _, suffix := range []string{"admin", "op", "ro"} {
		if value == "usr_"+organization+"_"+suffix {
			return true
		}
	}
	return false
}

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
	for _, site := range sites {
		grant := id.grant(site)
		if grant == nil || grant.Role != "admin" || grant.Scope != "back" {
			fail(w, 403, "Administrator access to every workspace is required")
			return
		}
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
	// Bound work before database metadata queries, including empty-table attacks.
	if len(backup.Tables) > 200 {
		fail(w, 400, "Backup exceeds the 200 table limit")
		return
	}
	rowCount := 0
	for _, rows := range backup.Tables {
		if rows == nil {
			fail(w, 400, "Backup tables must contain arrays")
			return
		}
		rowCount += len(rows)
		if rowCount > 10000 {
			fail(w, 400, "Backup exceeds the 10,000 row limit")
			return
		}
	}
	counts := map[string]int{}
	warnings := []string{}
	identityReferences := map[string]int{}
	legacyIdentities := map[string]int{}
	duplicateIDs := map[string]int{}
	businessWarnings := map[string]int{}
	destinationConflicts := map[string]int{}
	total := 0
	for name, rows := range backup.Tables {
		if name == "station_accounts" {
			if rows == nil || len(rows) != 0 {
				fail(w, 400, "Backup contains authentication data; export a backup without account records")
				return
			}
			warnings = append(warnings, "Empty legacy station_accounts table was ignored; account data is never imported")
			continue
		}
		if !(strings.HasPrefix(name, "mes_") || strings.HasPrefix(name, "erp_") || strings.HasPrefix(name, "pos_") || strings.HasPrefix(name, "crm_") || strings.HasPrefix(name, "dining_") || strings.HasPrefix(name, "shop_")) {
			fail(w, 400, "Unknown backup table")
			return
		}
		var exists int
		if err := a.db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?", name).Scan(&exists); err != nil {
			fail(w, 500, "Unable to inspect destination schema")
			return
		}
		canCheckConflicts := false
		if exists == 0 {
			warnings = append(warnings, fmt.Sprintf("Table %s does not exist in the destination schema", name))
		} else {
			info, err := a.db.Query("PRAGMA table_info(\"" + strings.ReplaceAll(name, "\"", "\"\"") + "\")")
			if err != nil {
				fail(w, 500, "Unable to inspect destination schema")
				return
			}
			columns := map[string]bool{}
			types := map[string]string{}
			required := map[string]bool{}
			for info.Next() {
				var cid, notnull, pk int
				var column, typ string
				var def any
				if err = info.Scan(&cid, &column, &typ, &notnull, &def, &pk); err != nil {
					break
				}
				columns[camel(column)] = true
				types[camel(column)] = strings.ToUpper(typ)
				if notnull != 0 && def == nil {
					required[camel(column)] = true
				}
			}
			if err == nil {
				err = info.Err()
			}
			info.Close()
			if err != nil {
				fail(w, 500, "Unable to inspect destination schema")
				return
			}
			canCheckConflicts = columns["id"] && columns["organizationId"]
			unknown := map[string]bool{}
			missing := map[string]int{}
			invalidTypes := map[string]int{}
			for _, row := range rows {
				for key := range required {
					if value, found := row[key]; !found || value == nil {
						missing[key]++
					}
				}
				for key, value := range row {
					if !columns[key] {
						unknown[key] = true
						continue
					}
					if value == nil {
						continue
					}
					typ := types[key]
					valid := true
					if legacyBooleanFields[name+"."+key] {
						_, valid = value.(bool)
					} else if strings.Contains(typ, "INT") {
						switch v := value.(type) {
						case float64:
							valid = math.Trunc(v) == v && math.Abs(v) <= 9007199254740991
						default:
							valid = false
						}
					} else if strings.Contains(typ, "TEXT") || strings.Contains(typ, "CHAR") || strings.Contains(typ, "CLOB") {
						_, valid = value.(string)
					}
					if !valid {
						invalidTypes[key]++
					}
				}
			}
			for key := range unknown {
				warnings = append(warnings, fmt.Sprintf("Field %s.%s does not exist in the destination schema", name, key))
			}
			for key, count := range invalidTypes {
				warnings = append(warnings, fmt.Sprintf("Table %s has %d rows with an invalid type for %s", name, count, key))
			}
			for key, count := range missing {
				warnings = append(warnings, fmt.Sprintf("Table %s has %d rows missing required field %s", name, count, key))
			}
		}
		counts[name] = len(rows)
		total += len(rows)
		if total > 10000 {
			fail(w, 400, "Backup exceeds the 10,000 row limit")
			return
		}
		seen := map[string]bool{}
		invalidIDs := 0
		for _, row := range rows {
			if row["organizationId"] != backup.OrganizationID {
				fail(w, 400, "Backup contains a row from another organization")
				return
			}
			key, valid := row["id"].(string)
			if !valid || key == "" {
				invalidIDs++
			} else if seen[key] {
				duplicateIDs[name]++
			} else {
				seen[key] = true
			}
			number := func(key string) (float64, bool) { v, ok := row[key].(float64); return v, ok }
			stock, hasStock := number("stockQuantity")
			reserved, hasReserved := number("reservedQuantity")
			if hasStock && (stock < 0 || (hasReserved && (reserved < 0 || reserved > stock))) {
				businessWarnings[name+".stock"]++
			}
			if name == "mes_work_orders" {
				good, g := number("completedQuantity")
				scrap, s := number("scrappedQuantity")
				target, t := number("targetQuantity")
				if g && s && t && (good < 0 || scrap < 0 || good+scrap > target) {
					businessWarnings[name+".production"]++
				}
			}
			if name == "erp_invoices" {
				paid, p := number("paidAmount")
				total, t := number("totalAmount")
				if p && t && (paid < 0 || paid > total) {
					businessWarnings[name+".payment"]++
				}
			}
			if name == "erp_purchase_order_lines" || name == "erp_sales_order_lines" {
				field := "receivedQuantity"
				if name == "erp_sales_order_lines" {
					field = "shippedQuantity"
				}
				fulfilled, f := number(field)
				quantity, q := number("quantity")
				if f && q && (quantity < 0 || fulfilled < 0 || fulfilled > quantity) {
					businessWarnings[name+".fulfillment"]++
				}
			}
			if name == "pos_sale_lines" {
				refunded, r := number("refundedQuantity")
				quantity, q := number("quantity")
				if r && q && (quantity <= 0 || refunded < 0 || refunded > quantity) {
					businessWarnings[name+".refund"]++
				}
			}
			status, _ := row["status"].(string)
			if (name == "pos_shifts" && status == "open") || (name == "pos_held_carts" && status == "retrieved") || (name == "shop_inventory_reservations" && status == "active") {
				businessWarnings[name+".activeState"]++
			}
			for _, field := range legacyIdentityFields[name] {
				if value, ok := row[field].(string); ok && value != "" {
					if name == "shop_inventory_reservations" && field == "sessionId" && !isLegacyDemoIdentity(value, backup.OrganizationID) {
						businessWarnings["shop_inventory_reservations.opaqueSession"]++
						continue
					}
					identityReferences[name+"."+field]++
					legacyIdentities[value]++
				}
			}
		}
		if invalidIDs > 0 {
			warnings = append(warnings, fmt.Sprintf("Table %s contains %d missing or invalid IDs", name, invalidIDs))
		}
		if canCheckConflicts && len(seen) > 0 {
			ids := make([]string, 0, len(seen))
			for key := range seen {
				ids = append(ids, key)
			}
			for start := 0; start < len(ids); start += 400 {
				end := start + 400
				if end > len(ids) {
					end = len(ids)
				}
				args := []any{id.OrganizationID}
				marks := make([]string, 0, end-start)
				for _, key := range ids[start:end] {
					args = append(args, key)
					marks = append(marks, "?")
				}
				var count int
				query := "SELECT count(*) FROM \"" + strings.ReplaceAll(name, "\"", "\"\"") + "\" WHERE organization_id=? AND id IN (" + strings.Join(marks, ",") + ")"
				if err := a.db.QueryRow(query, args...).Scan(&count); err != nil {
					fail(w, 500, "Unable to inspect destination conflicts")
					return
				}
				destinationConflicts[name] += count
			}
		}
	}
	openRegisters := map[string]bool{}
	for _, row := range backup.Tables["pos_shifts"] {
		status, _ := row["status"].(string)
		register, ok := row["registerId"].(string)
		if status != "open" || !ok || register == "" {
			continue
		}
		if openRegisters[register] {
			businessWarnings["pos_shifts.duplicateOpenRegister"]++
		}
		openRegisters[register] = true
	}
	orderPayment := map[string]string{}
	for _, row := range backup.Tables["shop_orders"] {
		id, idOK := row["id"].(string)
		payment, paymentOK := row["paymentStatus"].(string)
		if idOK && paymentOK {
			orderPayment[id] = payment
		}
	}
	type orderItemKey struct {
		order, variant string
		quantity       float64
	}
	orderItems := map[orderItemKey]int{}
	reservationItems := map[orderItemKey]int{}
	itemCount := map[string]int{}
	reservationCount := map[string]int{}
	for _, row := range backup.Tables["shop_order_items"] {
		order, o := row["orderId"].(string)
		variant, v := row["variantId"].(string)
		quantity, q := row["quantity"].(float64)
		if o {
			itemCount[order]++
		}
		if o && v && q {
			orderItems[orderItemKey{order, variant, quantity}]++
		}
	}
	for _, row := range backup.Tables["shop_inventory_reservations"] {
		status, _ := row["status"].(string)
		if status != "active" {
			continue
		}
		if quantity, ok := row["quantity"].(float64); !ok || quantity <= 0 || math.Trunc(quantity) != quantity {
			businessWarnings["shop_inventory_reservations.invalidQuantity"]++
		}
		if expires, ok := row["expiresAt"].(string); !ok {
			businessWarnings["shop_inventory_reservations.invalidExpiry"]++
		} else if expiry, err := time.Parse(time.RFC3339Nano, expires); err != nil {
			businessWarnings["shop_inventory_reservations.invalidExpiry"]++
		} else if !expiry.After(time.Now()) {
			businessWarnings["shop_inventory_reservations.expiredActive"]++
		}
		order, ok := row["cartId"].(string)
		if ok {
			reservationCount[order]++
		}
		variant, variantOK := row["variantId"].(string)
		quantity, quantityOK := row["quantity"].(float64)
		if !ok || !variantOK || !quantityOK || orderItems[orderItemKey{order, variant, quantity}] == 0 {
			businessWarnings["shop_inventory_reservations.unmatchedItem"]++
		} else {
			reservationItems[orderItemKey{order, variant, quantity}]++
		}
		payment, found := orderPayment[order]
		if !ok || !found || (payment != "pending" && payment != "failed") {
			businessWarnings["shop_inventory_reservations.orderState"]++
		}
	}
	for key, count := range orderItems {
		if (orderPayment[key.order] == "pending" || orderPayment[key.order] == "failed") && reservationItems[key] != count {
			businessWarnings["shop_orders.reservationItemMismatch"]++
		}
	}
	for order, payment := range orderPayment {
		if payment == "pending" || payment == "failed" {
			if itemCount[order] == 0 || reservationCount[order] != itemCount[order] {
				businessWarnings["shop_orders.incompleteReservations"]++
			}
		}
	}
	type journalAmounts struct {
		debit, credit float64
		lines         int
		invalid       bool
	}
	journals := map[string]journalAmounts{}
	for _, row := range backup.Tables["erp_journal_lines"] {
		id, idOK := row["journalId"].(string)
		debit, dOK := row["debitAmount"].(float64)
		credit, cOK := row["creditAmount"].(float64)
		if !idOK {
			continue
		}
		totals := journals[id]
		totals.lines++
		code, codeOK := row["accountCode"].(string)
		name, nameOK := row["accountName"].(string)
		if !dOK || !cOK || debit < 0 || credit < 0 || debit > 1000000000000 || credit > 1000000000000 || (debit > 0 && credit > 0) || !codeOK || strings.TrimSpace(code) == "" || !nameOK || strings.TrimSpace(name) == "" {
			totals.invalid = true
		} else {
			totals.debit += debit
			totals.credit += credit
		}
		journals[id] = totals
	}
	for _, row := range backup.Tables["erp_journal_entries"] {
		id, ok := row["id"].(string)
		status, _ := row["status"].(string)
		if !ok || status != "posted" {
			continue
		}
		amounts := journals[id]
		if amounts.invalid || amounts.lines < 2 || amounts.lines > 100 || amounts.debit <= 0 || amounts.debit != amounts.credit {
			businessWarnings["erp_journal_entries.invalidJournal"]++
		}
	}
	ledgerBalances := map[string]map[string]float64{}
	for _, row := range backup.Tables["erp_stock_ledger"] {
		item, itemOK := row["itemId"].(string)
		warehouse, warehouseOK := row["warehouseId"].(string)
		change, changeOK := row["quantityChange"].(float64)
		balance, balanceOK := row["balanceAfter"].(float64)
		if !itemOK || !warehouseOK || !changeOK || !balanceOK {
			businessWarnings["erp_stock_ledger.invalid"]++
			continue
		}
		if ledgerBalances[item] == nil {
			ledgerBalances[item] = map[string]float64{}
		}
		if balance < 0 || ledgerBalances[item][warehouse]+change != balance {
			businessWarnings["erp_stock_ledger.balance"]++
		}
		ledgerBalances[item][warehouse] = balance
	}
	missingTables := []string{}
	for _, name := range legacyBackupTables {
		if _, ok := backup.Tables[name]; !ok {
			missingTables = append(missingTables, name)
		}
	}
	idsByTable := map[string]map[string]bool{}
	for table, rows := range backup.Tables {
		idsByTable[table] = map[string]bool{}
		for _, row := range rows {
			if key, ok := row["id"].(string); ok && key != "" {
				idsByTable[table][key] = true
			}
		}
	}
	missingReferences := map[string]int{}
	for table, rows := range backup.Tables {
		prefix := strings.SplitN(table, "_", 2)[0]
		for _, row := range rows {
			for field, value := range row {
				target := legacyReferenceTargets[prefix+"_"+field]
				if table == "shop_inventory_reservations" && field == "cartId" {
					target = "shop_orders"
				}
				if target == "" || value == nil {
					continue
				}
				key, ok := value.(string)
				if !ok || key == "" || !idsByTable[target][key] {
					missingReferences[table+"."+field]++
				}
			}
		}
	}
	ok(w, map[string]any{"sourceOrganization": backup.OrganizationID, "destinationOrganization": id.OrganizationID, "exportedAt": backup.ExportedAt, "rowCount": total, "tableCounts": counts, "schemaWarnings": warnings, "identityReferences": identityReferences, "legacyIdentities": legacyIdentities, "duplicateIds": duplicateIDs, "destinationConflicts": destinationConflicts, "missingReferences": missingReferences, "missingTables": missingTables, "businessWarnings": businessWarnings, "readyToImport": false, "notice": "Preliminary inspection only; schema, references, identities and business rules have not been validated. No data was imported."})
}
