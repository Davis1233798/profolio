package main

import "testing"

func TestLegacyLedgerOrderIndependent(t *testing.T) {
	row := func(change, balance float64) map[string]any {
		return map[string]any{"itemId": "item", "warehouseId": "warehouse", "quantityChange": change, "balanceAfter": balance}
	}
	if got := inspectLegacyLedger([]map[string]any{row(5, 5), row(-2, 3)}); len(got) != 0 {
		t.Fatalf("valid ledger: %v", got)
	}
	if got := inspectLegacyLedger([]map[string]any{row(-2, 3), row(5, 5)}); got["erp_stock_ledger.balance"] != 0 || got["erp_stock_ledger.exportOrder"] == 0 {
		t.Fatalf("reordered ledger must report replay order: %v", got)
	}
	for _, rows := range [][]map[string]any{
		{row(5, 5), row(-2, 4)},
		{row(5, 5), row(1, 8), row(-1, 7)}, // disconnected cycle
		{row(-1, -1)},
	} {
		if got := inspectLegacyLedger(rows); got["erp_stock_ledger.balance"] == 0 {
			t.Fatalf("invalid ledger accepted: %v", rows)
		}
	}
}
