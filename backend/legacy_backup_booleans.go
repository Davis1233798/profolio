package main

// Boolean fields exported by the legacy Drizzle schema.
var legacyBooleanFields = map[string]bool{
	"mes_bom_versions.isActive":          true,
	"mes_work_orders.materialsStaged":    true,
	"erp_items.isActive":                 true,
	"erp_warehouses.isActive":            true,
	"erp_suppliers.isActive":             true,
	"erp_customers.isActive":             true,
	"erp_fiscal_periods.isClosed":        true,
	"pos_registers.isActive":             true,
	"pos_catalog_items.isActive":         true,
	"pos_sales.isReprint":                true,
	"crm_stages.isWon":                   true,
	"crm_stages.isLost":                  true,
	"crm_activities.completed":           true,
	"crm_quotes.isLocked":                true,
	"crm_tickets.isSlaBreached":          true,
	"crm_consents.marketingEmailAllowed": true,
	"dining_menu_items.isSoldOut":        true,
	"dining_modifier_groups.isRequired":  true,
	"dining_kitchen_tickets.urgentFlag":  true,
	"shop_products.isActive":             true,
	"shop_variants.isActive":             true,
	"shop_promotions.isActive":           true,
	"shop_reviews.isVisible":             true,
}
