package main

import (
	"fmt"
	"strings"
)

// validateStagedReferences checks links within the candidate only; it does not
// establish that a candidate can safely be merged into a destination workspace.
func validateStagedReferences(data map[string][]map[string]any) error {
	ids := map[string]map[string]bool{}
	for table, rows := range data {
		ids[table] = map[string]bool{}
		for _, row := range rows {
			id, ok := row["id"].(string)
			if !ok || id == "" || ids[table][id] {
				return fmt.Errorf("invalid or duplicate ID in %s", table)
			}
			ids[table][id] = true
		}
	}
	for table, rows := range data {
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
				id, ok := value.(string)
				if !ok || id == "" || !ids[target][id] {
					return fmt.Errorf("missing linked record %s.%s", table, field)
				}
			}
			if table == "erp_invoices" {
				invoice, _ := row["invoiceType"].(string)
				kind, _ := row["partnerType"].(string)
				partner, _ := row["partnerId"].(string)
				target := ""
				if invoice == "payable" && kind == "supplier" {
					target = "erp_suppliers"
				}
				if invoice == "receivable" && kind == "customer" {
					target = "erp_customers"
				}
				if target == "" || partner == "" || !ids[target][partner] {
					return fmt.Errorf("invalid invoice partner")
				}
			}
		}
	}
	return nil
}
