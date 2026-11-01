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

func TestStagingRejectsActiveTransactions(t *testing.T) {
	for _, example := range []struct{ table, status string }{
		{"pos_shifts", "open"}, {"pos_held_carts", "retrieved"}, {"shop_inventory_reservations", "active"},
	} {
		if err := validateStagedBusiness(map[string][]map[string]any{example.table: {{"status": example.status}}}); err == nil {
			t.Fatalf("active %s accepted", example.table)
		}
	}
	for _, status := range []string{"pending", "failed"} {
		if err := validateStagedBusiness(map[string][]map[string]any{"shop_orders": {{"paymentStatus": status}}}); err == nil {
			t.Fatalf("unsettled order %s accepted", status)
		}
	}
}

func TestStagingRejectsUnbalancedPostedJournal(t *testing.T) {
	data := map[string][]map[string]any{
		"erp_journal_entries": {{"id": "journal", "status": "posted"}},
		"erp_journal_lines": {
			{"journalId": "journal", "accountCode": "100", "accountName": "Cash", "debitAmount": float64(10), "creditAmount": float64(0)},
			{"journalId": "journal", "accountCode": "200", "accountName": "Payable", "debitAmount": float64(0), "creditAmount": float64(9)},
		},
	}
	if err := validateStagedBusiness(data); err == nil {
		t.Fatal("unbalanced journal accepted")
	}
	data["erp_journal_lines"][1]["creditAmount"] = float64(10)
	if err := validateStagedBusiness(data); err != nil {
		t.Fatal(err)
	}
}
