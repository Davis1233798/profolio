package main

import "fmt"

// validateStagedBusiness enforces basic invariants which SQLite update-only
// triggers cannot protect during bulk inserts. It is not a full domain audit.
func validateStagedBusiness(data map[string][]map[string]any) error {
	for table, rows := range data {
		for _, row := range rows {
			number := func(key string) (float64, bool) { value, ok := row[key].(float64); return value, ok }
			stock, hasStock := number("stockQuantity")
			reserved, hasReserved := number("reservedQuantity")
			if hasStock && (stock < 0 || (hasReserved && (reserved < 0 || reserved > stock))) {
				return fmt.Errorf("invalid stock in %s", table)
			}
			switch table {
			case "mes_work_orders":
				good, g := number("completedQuantity")
				scrap, s := number("scrappedQuantity")
				target, t := number("targetQuantity")
				if g && s && t && (target < 0 || good < 0 || scrap < 0 || good+scrap > target) {
					return fmt.Errorf("invalid work order quantities")
				}
			case "erp_invoices":
				paid, p := number("paidAmount")
				total, t := number("totalAmount")
				if p && t && (total < 0 || paid < 0 || paid > total) {
					return fmt.Errorf("invalid invoice payment")
				}
			case "erp_purchase_order_lines", "erp_sales_order_lines":
				field := "receivedQuantity"
				if table == "erp_sales_order_lines" {
					field = "shippedQuantity"
				}
				fulfilled, f := number(field)
				quantity, q := number("quantity")
				if f && q && (quantity < 0 || fulfilled < 0 || fulfilled > quantity) {
					return fmt.Errorf("invalid order fulfillment in %s", table)
				}
			case "pos_sale_lines":
				refunded, r := number("refundedQuantity")
				quantity, q := number("quantity")
				if r && q && (quantity <= 0 || refunded < 0 || refunded > quantity) {
					return fmt.Errorf("invalid refund quantity")
				}
			}
		}
	}
	return nil
}
