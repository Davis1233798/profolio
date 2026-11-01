package main

import "fmt"

// validateStagedBusiness enforces basic invariants which SQLite update-only
// triggers cannot protect during bulk inserts. It is not a full domain audit.
func validateStagedBusiness(data map[string][]map[string]any) error {
	type returnTotal struct{ quantity, amount float64 }
	returns := map[string]returnTotal{}
	for _, row := range data["shop_returns"] {
		item, itemOK := row["orderItemId"].(string)
		quantity, quantityOK := row["quantity"].(float64)
		amount, amountOK := row["refundAmount"].(float64)
		if !itemOK || item == "" || !quantityOK || !amountOK || quantity <= 0 || quantity > 1000000 || amount < 0 || amount > 1000000000000000 {
			return fmt.Errorf("invalid commerce return")
		}
		total := returns[item]
		total.quantity += quantity
		total.amount += amount
		if total.quantity > 1000000 || total.amount > 1000000000000000 {
			return fmt.Errorf("commerce returns exceed supported bounds")
		}
		returns[item] = total
	}
	type commerceLines struct {
		gross, net float64
		count      int
	}
	linesByOrder := map[string]commerceLines{}
	for _, row := range data["shop_order_items"] {
		id, _ := row["id"].(string)
		order, orderOK := row["orderId"].(string)
		quantity, q := row["quantity"].(float64)
		amount, a := row["lineTotal"].(float64)
		price, p := row["unitPrice"].(float64)
		if !orderOK || order == "" || !q || !a || !p || quantity <= 0 || quantity > 1000000 || price < 0 || price > 1000000000 || amount < 0 || amount > quantity*price {
			return fmt.Errorf("invalid commerce order line")
		}
		lines := linesByOrder[order]
		lines.gross += quantity * price
		lines.net += amount
		lines.count++
		if lines.gross > 1000000000000000 || lines.net > 1000000000000000 {
			return fmt.Errorf("commerce order exceeds supported bounds")
		}
		linesByOrder[order] = lines
		if total, exists := returns[id]; exists && (!q || !a || quantity <= 0 || amount < 0 || total.quantity > quantity || total.amount > amount) {
			return fmt.Errorf("commerce returns exceed order item")
		}
	}
	for _, row := range data["shop_orders"] {
		id, _ := row["id"].(string)
		subtotal, s := row["subtotal"].(float64)
		discount, d := row["discountAmount"].(float64)
		shipping, h := row["shippingFee"].(float64)
		total, t := row["totalAmount"].(float64)
		lines := linesByOrder[id]
		if !s || !d || !h || !t || subtotal < 0 || discount < 0 || discount > subtotal || shipping < 0 || total != subtotal-discount+shipping || lines.count == 0 || lines.gross != subtotal || lines.net != subtotal-discount {
			return fmt.Errorf("invalid commerce order total for order %q: check subtotal, discount, shipping and item totals in the source workspace", id)
		}
	}
	type journalTotal struct {
		debit, credit float64
		lines         int
		invalid       bool
	}
	journalTotals := map[string]journalTotal{}
	for _, row := range data["erp_journal_lines"] {
		id, ok := row["journalId"].(string)
		if !ok || id == "" {
			return fmt.Errorf("invalid journal reference")
		}
		t := journalTotals[id]
		t.lines++
		debit, d := row["debitAmount"].(float64)
		credit, c := row["creditAmount"].(float64)
		code, co := row["accountCode"].(string)
		name, na := row["accountName"].(string)
		if !d || !c || debit < 0 || credit < 0 || debit > 1000000000000 || credit > 1000000000000 || (debit > 0 && credit > 0) || !co || code == "" || !na || name == "" {
			t.invalid = true
		} else {
			t.debit += debit
			t.credit += credit
		}
		journalTotals[id] = t
	}
	for _, row := range data["erp_journal_entries"] {
		if row["status"] != "posted" {
			continue
		}
		id, _ := row["id"].(string)
		t := journalTotals[id]
		if t.invalid || t.lines < 2 || t.lines > 100 || t.debit <= 0 || t.debit != t.credit {
			return fmt.Errorf("invalid posted journal")
		}
	}
	for table, rows := range data {
		for _, row := range rows {
			status, _ := row["status"].(string)
			if (table == "pos_shifts" && status == "open") || (table == "pos_held_carts" && status == "retrieved") || (table == "shop_inventory_reservations" && status == "active") {
				return fmt.Errorf("active transactions require resolution before migration in %s", table)
			}
			if table == "shop_orders" && (row["paymentStatus"] == "pending" || row["paymentStatus"] == "failed") {
				return fmt.Errorf("unsettled commerce orders require resolution before migration")
			}
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
