package main

import "testing"

func TestStagedBusinessRejectsInvalidTotals(t *testing.T) {
	for _, example := range []struct {
		table string
		row   map[string]any
	}{
		{"shop_variants", map[string]any{"stockQuantity": float64(2), "reservedQuantity": float64(3)}},
		{"mes_work_orders", map[string]any{"targetQuantity": float64(10), "completedQuantity": float64(9), "scrappedQuantity": float64(2)}},
		{"erp_invoices", map[string]any{"totalAmount": float64(10), "paidAmount": float64(11)}},
		{"erp_purchase_order_lines", map[string]any{"quantity": float64(3), "receivedQuantity": float64(4)}},
		{"pos_sale_lines", map[string]any{"quantity": float64(3), "refundedQuantity": float64(4)}},
	} {
		if err := validateStagedBusiness(map[string][]map[string]any{example.table: {example.row}}); err == nil {
			t.Fatalf("invalid %s accepted", example.table)
		}
	}
}
