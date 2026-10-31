package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type Dataset struct {
	Key, Table, Label string
	Front             []string
}

var datasets = map[string][]Dataset{
	"mes":    {{"products", "mes_products", "Products", []string{"id", "sku", "name", "unit", "status"}}, {"workOrders", "mes_work_orders", "Work orders", []string{"id", "order_no", "product_id", "status", "target_quantity", "completed_quantity", "scrapped_quantity", "materials_staged"}}, {"operations", "mes_operations", "Operations", []string{"id", "work_order_id", "sequence", "name", "status"}}, {"lots", "mes_material_lots", "Material lots", []string{"id", "lot_number", "material_sku", "current_quantity", "status"}}, {"reports", "mes_production_reports", "Production reports", []string{"id", "work_order_id", "good_quantity", "scrap_quantity", "created_at"}}, {"qualityChecks", "mes_quality_checks", "Quality checks", []string{"id", "work_order_id", "sample_quantity", "passed_quantity", "failed_quantity", "status", "disposition", "created_at"}}, {"workCenters", "mes_work_centers", "Work centers", []string{"id", "code", "name", "status"}}, {"materials", "mes_work_order_materials", "Material movements", nil}, {"bomVersions", "mes_bom_versions", "BOM versions", nil}, {"bomItems", "mes_bom_items", "BOM items", nil}, {"downtimeEvents", "mes_downtime_events", "Downtime", []string{"id", "work_center_id", "start_time", "end_time", "duration_minutes", "reason", "status"}}},
	"erp":    {{"items", "erp_items", "Items", []string{"id", "sku", "name", "unit", "is_active"}}, {"warehouses", "erp_warehouses", "Warehouses", []string{"id", "name", "code"}}, {"stockLedger", "erp_stock_ledger", "Stock ledger", []string{"id", "item_id", "warehouse_id", "quantity_change", "created_at"}}, {"purchaseOrders", "erp_purchase_orders", "Purchase orders", nil}, {"purchaseLines", "erp_purchase_order_lines", "Purchase lines", nil}, {"salesOrders", "erp_sales_orders", "Sales orders", nil}, {"salesLines", "erp_sales_order_lines", "Sales lines", nil}, {"receipts", "erp_receipts", "Receipts", nil}, {"receiptLines", "erp_receipt_lines", "Receipt lines", nil}, {"invoices", "erp_invoices", "Receivables and payables", nil}, {"payments", "erp_payments", "Payments", nil}, {"fiscalPeriods", "erp_fiscal_periods", "Fiscal periods", nil}, {"suppliers", "erp_suppliers", "Suppliers", nil}, {"customers", "erp_customers", "Customers", nil}, {"journalEntries", "erp_journal_entries", "Journal entries", nil}, {"journalLines", "erp_journal_lines", "Journal lines", nil}},
	"pos":    {{"catalogItems", "pos_catalog_items", "Products", []string{"id", "name", "barcode", "price", "stock_quantity", "is_active"}}, {"sales", "pos_sales", "Receipts", []string{"id", "receipt_number", "total_amount", "payment_method", "created_at"}}, {"saleLines", "pos_sale_lines", "Sale lines", nil}, {"stores", "pos_stores", "Stores", []string{"id", "name", "code"}}, {"registers", "pos_registers", "Registers", []string{"id", "name", "store_id", "is_active"}}, {"shifts", "pos_shifts", "Shifts", []string{"id", "store_id", "register_id", "cashier_id", "status", "opening_cash", "opened_at"}}, {"heldCarts", "pos_held_carts", "Held carts", []string{"id", "store_id", "cart_name", "items_json", "status", "locked_by", "held_at"}}},
	"crm":    {{"stages", "crm_stages", "Sales stages", nil}, {"accounts", "crm_accounts", "Customers", nil}, {"contacts", "crm_contacts", "Contacts", nil}, {"leads", "crm_leads", "Leads", []string{"id", "name", "company", "status"}}, {"opportunities", "crm_opportunities", "Opportunities", nil}, {"activities", "crm_activities", "Activities", []string{"id", "activity_type", "subject", "due_date", "completed", "completed_at", "owner_id"}}, {"tickets", "crm_tickets", "Support tickets", []string{"id", "subject", "status", "priority", "sla_hours", "created_at"}}, {"quotes", "crm_quotes", "Quotes", nil}, {"quoteItems", "crm_quote_items", "Quote items", nil}},
	"dining": {{"modifierGroups", "dining_modifier_groups", "Modifier groups", []string{"id", "name", "min_selection", "max_selection", "is_required"}}, {"modifierOptions", "dining_modifier_options", "Modifier options", []string{"id", "group_id", "name", "additional_price"}}, {"locations", "dining_locations", "Locations", []string{"id", "name", "service_fee_rate"}}, {"sessions", "dining_table_sessions", "Table sessions", []string{"id", "table_id", "guest_count", "status", "opened_at"}}, {"kitchenTickets", "dining_kitchen_tickets", "Kitchen tickets", []string{"id", "order_id", "order_item_id", "station", "item_name", "quantity", "modifiers_text", "status", "urgent_flag", "created_at"}}, {"tables", "dining_tables", "Tables", []string{"id", "location_id", "table_number", "capacity", "status"}}, {"orders", "dining_orders", "Orders", []string{"id", "session_id", "takeout_number", "status", "created_at"}}, {"orderItems", "dining_order_items", "Order items", []string{"id", "order_id", "item_name", "quantity", "line_total", "status"}}, {"menuItems", "dining_menu_items", "Menu", []string{"id", "name", "price", "category", "is_sold_out"}}, {"bills", "dining_bills", "Bills", nil}, {"reservations", "dining_reservations", "Reservations", []string{"id", "table_id", "guest_count", "reservation_time", "status"}}},
	"shop":   {{"products", "shop_products", "Products", []string{"id", "name", "slug", "description", "is_active"}}, {"variants", "shop_variants", "Product variants", []string{"id", "product_id", "sku", "title", "price", "stock_quantity"}}, {"orders", "shop_orders", "Orders", []string{"id", "order_number", "fulfillment_status", "payment_status", "total_amount", "created_at"}}, {"items", "shop_order_items", "Order items", []string{"id", "order_id", "variant_id", "product_name", "variant_title", "quantity", "line_total"}}, {"returns", "shop_returns", "Returns", nil}, {"reviews", "shop_reviews", "Reviews", []string{"id", "product_id", "rating", "comment", "created_at"}}},
}

func camel(s string) string {
	parts := strings.Split(s, "_")
	for i := 1; i < len(parts); i++ {
		if len(parts[i]) > 0 {
			parts[i] = strings.ToUpper(parts[i][:1]) + parts[i][1:]
		}
	}
	return strings.Join(parts, "")
}
func queryMaps(db *sql.DB, query string, args ...any) ([]map[string]any, error) {
	rows, e := db.Query(query, args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	cols, e := rows.Columns()
	if e != nil {
		return nil, e
	}
	out := []map[string]any{}
	for rows.Next() {
		v := make([]any, len(cols))
		p := make([]any, len(cols))
		for i := range v {
			p[i] = &v[i]
		}
		if e = rows.Scan(p...); e != nil {
			return nil, e
		}
		m := map[string]any{}
		for i, c := range cols {
			if b, yes := v[i].([]byte); yes {
				v[i] = string(b)
			}
			m[camel(c)] = v[i]
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
func (a *App) stationAPI(w http.ResponseWriter, r *http.Request) {
	site, action := r.PathValue("site"), r.PathValue("action")
	if !knownSite(site) {
		fail(w, 404, "Workspace not found")
		return
	}
	id, e := a.identity(r)
	if e != nil {
		fail(w, 401, e.Error())
		return
	}
	g := id.grant(site)
	if g == nil {
		fail(w, 403, "No access to this workspace")
		return
	}
	if action == "service" && site == "dining" {
		a.diningService(w, r, id, g)
		return
	}
	if action == "order" && site == "dining" {
		a.diningOrder(w, r, id, g)
		return
	}
	if action == "table" && site == "dining" {
		a.diningTable(w, r, id, g)
		return
	}
	if action == "business" && site == "dining" {
		a.diningBusiness(w, r, id, g)
		return
	}
	if action == "administration" && site == "erp" {
		a.erpAdministration(w, r, id, g)
		return
	}
	if action == "catalog" && site == "erp" {
		a.erpCatalog(w, r, id, g)
		return
	}
	if action == "finance" && site == "erp" {
		a.erpFinance(w, r, id, g)
		return
	}
	if action == "stock-out" && site == "erp" {
		a.erpStockOut(w, r, id, g)
		return
	}
	if action == "purchase-create" && site == "erp" {
		a.erpCreatePurchase(w, r, id, g)
		return
	}
	if action == "purchasing" && site == "erp" {
		a.erpPurchasing(w, r, id, g)
		return
	}
	if action == "business" && site == "erp" {
		a.erpBusiness(w, r, id, g)
		return
	}
	if action == "support" && site == "crm" {
		a.crmSupport(w, r, id, g)
		return
	}
	if action == "quotes" && site == "crm" {
		a.crmQuotes(w, r, id, g)
		return
	}
	if action == "work" && site == "crm" {
		a.crmWork(w, r, id, g)
		return
	}
	if action == "business" && site == "crm" {
		a.crmBusiness(w, r, id, g)
		return
	}
	if action == "daily-report" && site == "pos" {
		a.posDailyReport(w, r, id, g)
		return
	}
	if action == "cart" && site == "pos" {
		a.posCart(w, r, id, g)
		return
	}
	if action == "business" && site == "pos" {
		a.posBusiness(w, r, id, g)
		return
	}
	if action == "cart-checkout" && site == "shop" {
		a.shopCartCheckout(w, r, id, g)
		return
	}
	if action == "after-sales" && site == "shop" {
		a.shopAfterSales(w, r, id, g)
		return
	}
	if action == "business" && site == "shop" {
		a.shopBusiness(w, r, id, g)
		return
	}
	if action == "work-orders" && site == "mes" {
		a.mesWorkOrder(w, r, id, g)
		return
	}
	if action == "bom" && site == "mes" {
		a.mesBOM(w, r, id, g)
		return
	}
	if action == "operations" && site == "mes" {
		a.mesOperations(w, r, id, g)
		return
	}
	if action == "business" && site == "mes" {
		a.mesBusiness(w, r, id, g)
		return
	}
	if action == "data" && r.Method == "GET" {
		front := r.URL.Query().Get("view") == "front"
		if !front && g.Scope != "back" {
			fail(w, 403, "Front-office accounts cannot read back-office data")
			return
		}
		out := map[string]any{}
		for _, d := range datasets[site] {
			if front && len(d.Front) == 0 {
				continue
			}
			columns := "*"
			if front {
				columns = strings.Join(d.Front, ",")
			}
			query := "SELECT " + columns + " FROM " + d.Table + " WHERE organization_id=?"
			args := []any{id.OrganizationID}
			if front && site == "crm" && d.Key == "activities" {
				query += " AND owner_id=?"
				args = append(args, id.UserID)
			}
			if front && site == "pos" && d.Key == "heldCarts" {
				query += " AND (status='held' OR (status='retrieved' AND locked_by=?))"
				args = append(args, id.UserID)
			}
			if front && site == "pos" && d.Key == "sales" {
				query += " AND cashier_id=?"
				args = append(args, id.UserID)
			}
			if front && site == "pos" && d.Key == "shifts" {
				query += " AND cashier_id=?"
				args = append(args, id.UserID)
			}
			if front && site == "shop" && d.Key == "items" {
				query += " AND order_id IN (SELECT id FROM shop_orders WHERE organization_id=? AND user_id=?)"
				args = append(args, id.OrganizationID, id.UserID)
			}
			if front && site == "shop" && d.Key == "reviews" {
				query += " AND is_visible=1"
			}
			if front && site == "shop" && d.Key == "orders" {
				query += " AND user_id=?"
				args = append(args, id.UserID)
			}
			rows, err := queryMaps(a.db, query+" ORDER BY rowid DESC LIMIT 500", args...)
			if err != nil {
				fail(w, 500, "Unable to read workspace data: "+d.Key)
				return
			}
			if site == "crm" && d.Key == "tickets" {
				for _, row := range rows {
					created, _ := row["createdAt"].(string)
					parsed, err := time.Parse(time.RFC3339, created)
					if err != nil {
						parsed, err = time.Parse("2006-01-02 15:04:05", created)
					}
					hours, valid := row["slaHours"].(int64)
					if err == nil && valid && hours >= 1 && hours <= 720 {
						due := crmSLADue(parsed, int(hours))
						row["dueAt"] = due.Format(time.RFC3339)
						row["isSlaBreached"] = row["status"] != "resolved" && time.Now().After(due)
					}
				}
			}
			out[d.Key] = rows
		}
		if site == "erp" && !front {
			rows, err := queryMaps(a.db, `SELECT l.account_code,MAX(l.account_name) AS account_name,SUM(l.debit_amount) AS debit_total,SUM(l.credit_amount) AS credit_total FROM erp_journal_lines l JOIN erp_journal_entries j ON j.id=l.journal_id AND j.organization_id=l.organization_id WHERE l.organization_id=? AND j.status='posted' GROUP BY l.account_code ORDER BY l.account_code`, id.OrganizationID)
			if err != nil {
				fail(w, 500, "Unable to calculate trial balance")
				return
			}
			out["trialBalance"] = rows
		}
		if site == "crm" && !front {
			rows, err := queryMaps(a.db, "SELECT c.contact_id,c.email FROM crm_consents c JOIN crm_contacts p ON p.id=c.contact_id AND p.organization_id=c.organization_id WHERE c.organization_id=? AND c.marketing_email_allowed=1 ORDER BY c.rowid DESC LIMIT 500", id.OrganizationID)
			if err != nil {
				fail(w, 500, "Unable to read marketing consent")
				return
			}
			out["marketingRecipients"] = rows
		}
		if site == "dining" {
			rows, err := queryMaps(a.db, `SELECT s.id AS session_id,l.service_fee_rate,COALESCE(SUM(CASE WHEN o.status='placed' AND i.status!='cancelled' THEN i.line_total ELSE 0 END),0) AS subtotal FROM dining_table_sessions s JOIN dining_tables t ON t.id=s.table_id AND t.organization_id=s.organization_id JOIN dining_locations l ON l.id=t.location_id AND l.organization_id=s.organization_id LEFT JOIN dining_orders o ON o.session_id=s.id AND o.organization_id=s.organization_id LEFT JOIN dining_order_items i ON i.order_id=o.id AND i.organization_id=o.organization_id WHERE s.organization_id=? AND s.status='active' GROUP BY s.id,l.service_fee_rate ORDER BY s.rowid DESC LIMIT 500`, id.OrganizationID)
			if err != nil {
				fail(w, 500, "Unable to calculate table bills")
				return
			}
			out["billSummaries"] = rows
		}
		if site == "shop" && !front {
			events, err := queryMaps(a.db, "SELECT id,status,retry_count,created_at FROM outbox_events WHERE organization_id=? AND event_type='shop.paid' ORDER BY rowid DESC LIMIT 100", id.OrganizationID)
			if err != nil {
				fail(w, 500, "Unable to read commerce events")
				return
			}
			out["fulfillmentEvents"] = events
		}
		ok(w, out)
		return
	}
	if action == "users" {
		if g.Role != "admin" || g.Scope != "back" {
			fail(w, 403, "Only workspace administrators can manage accounts")
			return
		}
		if r.Method == "GET" {
			rows, e := queryMaps(a.db, `SELECT a.user_id,a.email,u.display_name,g.role,g.scope,g.enabled FROM station_accounts a JOIN users u ON u.id=a.user_id JOIN station_grants g ON g.user_id=a.user_id WHERE a.organization_id=? AND g.site=?`, id.OrganizationID, site)
			if e != nil {
				fail(w, 500, "Unable to read accounts")
				return
			}
			ok(w, rows)
			return
		}
		if r.Method == "POST" {
			a.manageUser(w, r, id, site)
			return
		}
	}
	if action == "print" && r.Method == "GET" {
		if g.Scope != "back" {
			fail(w, 403, "Print center requires back-office access")
			return
		}
		a.printData(w, r, id, site)
		return
	}
	fail(w, 501, "This operation has not been migrated to Go. No changes were made")
}
func (a *App) manageUser(w http.ResponseWriter, r *http.Request, id *Identity, site string) {
	var input struct {
		UserID   string `json:"userId"`
		Email    string `json:"email"`
		Name     string `json:"name"`
		Password string `json:"password"`
		Role     string `json:"role"`
		Scope    string `json:"scope"`
		Enabled  bool   `json:"enabled"`
	}
	if body(r, &input) != nil || (input.Role != "admin" && input.Role != "operator" && input.Role != "readonly") || (input.Scope != "front" && input.Scope != "back") || (input.Role == "admin" && input.Scope != "back") {
		fail(w, 400, "Invalid account or permission data")
		return
	}
	if input.UserID == id.UserID {
		fail(w, 409, "Ask another administrator to change your own permissions")
		return
	}
	hash := ""
	var e error
	if input.UserID == "" {
		input.Email = strings.ToLower(strings.TrimSpace(input.Email))
		if !strings.Contains(input.Email, "@") || len(input.Email) > 254 || len(input.Name) == 0 || len(input.Name) > 80 || len(input.Password) < 12 || len(input.Password) > 256 {
			fail(w, 400, "Provide a name, email and password of at least 12 characters")
			return
		}
		hash, e = passwordHash(input.Password, "")
		if e != nil {
			fail(w, 500, "Password processing failed")
			return
		}
	}
	tx, e := a.db.Begin()
	if e != nil {
		fail(w, 503, "Unable to begin account transaction")
		return
	}
	defer tx.Rollback()
	target := input.UserID
	if target == "" {
		target = token()
		if _, e = tx.Exec("INSERT INTO users(id,email,display_name) VALUES(?,?,?)", target, input.Email, input.Name); e == nil {
			_, e = tx.Exec("INSERT INTO station_accounts(user_id,organization_id,email,password_hash) VALUES(?,?,?,?)", target, id.OrganizationID, input.Email, hash)
		}
	} else {
		var n int
		e = tx.QueryRow("SELECT count(*) FROM station_accounts WHERE user_id=? AND organization_id=?", target, id.OrganizationID).Scan(&n)
		if e == nil && n != 1 {
			e = errors.New("Account does not belong to this organization")
		}
	}
	if e == nil {
		_, e = tx.Exec(`INSERT INTO station_grants(user_id,site,role,scope,enabled) VALUES(?,?,?,?,?) ON CONFLICT(user_id,site) DO UPDATE SET role=excluded.role,scope=excluded.scope,enabled=excluded.enabled`, target, site, input.Role, input.Scope, input.Enabled)
	}
	if e == nil {
		audit, _ := json.Marshal(map[string]any{"site": site, "role": input.Role, "scope": input.Scope, "enabled": input.Enabled})
		_, e = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,after_value) VALUES(?,?,?,'admin','STATION_GRANT','ACCOUNT',?,?)", token(), id.OrganizationID, id.UserID, target, string(audit))
	}
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		fail(w, 409, "Account update failed. Check email uniqueness and organization membership")
		return
	}
	ok(w, map[string]string{"userId": target})
}

type PrintKind struct{ Site, Dataset, Title, Lines, ForeignKey string }

var printKinds = map[string]PrintKind{
	"mes-lot-label": {"mes", "lots", "Material label", "", ""}, "mes-order-label": {"mes", "workOrders", "Work order label", "", ""}, "mes-order": {"mes", "workOrders", "Work orders", "mes_work_order_materials", "work_order_id"}, "mes-report": {"mes", "reports", "Production report", "", ""},
	"erp-item-label": {"erp", "items", "Item label", "", ""}, "erp-purchase": {"erp", "purchaseOrders", "Purchase orders", "erp_purchase_order_lines", "po_id"}, "erp-sale": {"erp", "salesOrders", "Sales orders", "erp_sales_order_lines", "so_id"}, "erp-receipt": {"erp", "receipts", "Receipts", "erp_receipt_lines", "receipt_id"},
	"pos-item-label": {"pos", "catalogItems", "Product label", "", ""}, "pos-receipt": {"pos", "sales", "Receipts", "pos_sale_lines", "sale_id"}, "pos-shift": {"pos", "shifts", "Shift report", "pos_sales", "shift_id"},
	"crm-account-label": {"crm", "accounts", "Customer label", "", ""}, "crm-quote": {"crm", "quotes", "Customer quote", "crm_quote_items", "quote_id"},
	"dining-menu-label": {"dining", "menuItems", "Menu item label", "", ""}, "dining-order": {"dining", "orders", "Dining order", "dining_order_items", "order_id"},
	"shop-product-label": {"shop", "variants", "Product variant label", "", ""}, "shop-order": {"shop", "orders", "Commerce order", "shop_order_items", "order_id"},
}

func (a *App) printData(w http.ResponseWriter, r *http.Request, id *Identity, site string) {
	kind, exists := printKinds[r.URL.Query().Get("kind")]
	if !exists || kind.Site != site {
		fail(w, 400, "Unsupported print format")
		return
	}
	recordID := r.URL.Query().Get("id")
	table := ""
	for _, d := range datasets[site] {
		if d.Key == kind.Dataset {
			table = d.Table
		}
	}
	rows, e := queryMaps(a.db, "SELECT * FROM "+table+" WHERE organization_id=? AND id=?", id.OrganizationID, recordID)
	if e != nil || len(rows) != 1 {
		fail(w, 404, "Document not found in this organization")
		return
	}
	lines := []map[string]any{}
	if kind.Lines != "" {
		lines, e = queryMaps(a.db, fmt.Sprintf("SELECT * FROM %s WHERE organization_id=? AND %s=?", kind.Lines, kind.ForeignKey), id.OrganizationID, recordID)
		if e != nil {
			fail(w, 500, "Unable to read document details")
			return
		}
	}
	ok(w, map[string]any{"title": kind.Title, "record": rows[0], "lines": lines, "printedBy": id.Name, "organizationId": id.OrganizationID})
}
