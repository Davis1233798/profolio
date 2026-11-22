import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const stationAccounts = sqliteTable('station_accounts', {
  userId: text('user_id').primaryKey(), organizationId: text('organization_id').notNull(),
  email: text('email').notNull(), passwordHash: text('password_hash').notNull(), disabled: integer('disabled').notNull().default(0),
}, t=>[uniqueIndex('station_accounts_email').on(t.organizationId,t.email)]);
export const stationGrants = sqliteTable('station_grants', {
  userId: text('user_id').notNull(), site: text('site').notNull(), role: text('role').notNull(),
  scope: text('scope').notNull(), enabled: integer('enabled').notNull().default(1),
},t=>[uniqueIndex('station_grants_user_site').on(t.userId,t.site)]);
export const stationSessions = sqliteTable('station_sessions', {
  tokenHash:text('token_hash').primaryKey(),userId:text('user_id').notNull(),expiresAt:integer('expires_at').notNull(),
});
export const stationLoginLimits = sqliteTable('station_login_limits', {
  key:text('key').primaryKey(),attempts:integer('attempts').notNull(),resetAt:integer('reset_at').notNull(),
});

// ==========================================
// 1. Common & Tenant Tables
// ==========================================

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const memberships = sqliteTable("memberships", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role").notNull().default("operator"), // admin, operator, readonly
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  actorId: text("actor_id").notNull(),
  actorRole: text("actor_role").notNull(),
  action: text("action").notNull(), // UPDATE_AMOUNT, UPDATE_ROLE, DEDUCT_STOCK, REFUND, etc.
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  beforeValue: text("before_value"),
  afterValue: text("after_value"),
  reason: text("reason"),
  requestId: text("request_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const idempotencyKeys = sqliteTable("idempotency_keys", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  key: text("key").notNull(),
  endpoint: text("endpoint").notNull(),
  requestHash: text("request_hash").notNull(),
  responseStatus: integer("response_status").notNull(),
  responseBody: text("response_body").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const outboxEvents = sqliteTable("outbox_events", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: text("payload").notNull(),
  status: text("status").notNull().default("pending"), // pending, processed, failed
  retryCount: integer("retry_count").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ==========================================
// 2. MES「ForgeFlow」Tables
// ==========================================

export const mesProducts = sqliteTable("mes_products", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  unit: text("unit").notNull().default("PCS"),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const mesBomVersions = sqliteTable("mes_bom_versions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  productId: text("product_id").notNull(),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("active"), // draft, active, archived
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const mesBomItems = sqliteTable("mes_bom_items", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  bomVersionId: text("bom_version_id").notNull(),
  materialSku: text("material_sku").notNull(),
  materialName: text("material_name").notNull(),
  quantityPerUnit: integer("quantity_per_unit").notNull(),
  unit: text("unit").notNull().default("PCS"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const mesWorkCenters = sqliteTable("mes_work_centers", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  capacityMinutesPerDay: integer("capacity_minutes_per_day").notNull().default(480),
  status: text("status").notNull().default("active"), // active, maintenance
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const mesWorkOrders = sqliteTable("mes_work_orders", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  orderNo: text("order_no").notNull(),
  productId: text("product_id").notNull(),
  bomVersionId: text("bom_version_id").notNull(),
  targetQuantity: integer("target_quantity").notNull(),
  completedQuantity: integer("completed_quantity").notNull().default(0),
  scrappedQuantity: integer("scrapped_quantity").notNull().default(0),
  status: text("status").notNull().default("draft"), // draft, released, in_progress, completed, closed
  materialsStaged: integer("materials_staged", { mode: "boolean" }).notNull().default(false),
  scheduledMinutes: integer("scheduled_minutes").notNull().default(480),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const mesOperations = sqliteTable("mes_operations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  workOrderId: text("work_order_id").notNull(),
  sequence: integer("sequence").notNull(),
  workCenterId: text("work_center_id").notNull(),
  name: text("name").notNull(),
  standardMinutesPerUnit: integer("standard_minutes_per_unit").notNull().default(1),
  status: text("status").notNull().default("pending"), // pending, running, completed
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const mesMaterialLots = sqliteTable("mes_material_lots", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  lotNumber: text("lot_number").notNull(),
  materialSku: text("material_sku").notNull(),
  initialQuantity: integer("initial_quantity").notNull(),
  currentQuantity: integer("current_quantity").notNull(),
  status: text("status").notNull().default("available"), // available, quarantined, consumed
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const mesWorkOrderMaterials = sqliteTable("mes_work_order_materials", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  workOrderId: text("work_order_id").notNull(),
  materialLotId: text("material_lot_id").notNull(),
  materialSku: text("material_sku").notNull(),
  issuedQuantity: integer("issued_quantity").notNull(),
  returnedQuantity: integer("returned_quantity").notNull().default(0),
  netQuantity: integer("net_quantity").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const mesProductionReports = sqliteTable("mes_production_reports", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  workOrderId: text("work_order_id").notNull(),
  operationId: text("operation_id").notNull(),
  operatorId: text("operator_id").notNull(),
  goodQuantity: integer("good_quantity").notNull(),
  scrapQuantity: integer("scrap_quantity").notNull(),
  reportTime: text("report_time").notNull().default(sql`CURRENT_TIMESTAMP`),
  notes: text("notes"),
  idempotencyKey: text("idempotency_key"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const mesQualityChecks = sqliteTable("mes_quality_checks", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  workOrderId: text("work_order_id").notNull(),
  reportId: text("report_id"),
  inspectorId: text("inspector_id").notNull(),
  sampleQuantity: integer("sample_quantity").notNull(),
  passedQuantity: integer("passed_quantity").notNull(),
  failedQuantity: integer("failed_quantity").notNull(),
  status: text("status").notNull().default("passed"), // passed, quarantined, reworked
  disposition: text("disposition"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const mesDowntimeEvents = sqliteTable("mes_downtime_events", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  workCenterId: text("work_center_id").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time"),
  durationMinutes: integer("duration_minutes").default(0),
  reason: text("reason").notNull(),
  reporterId: text("reporter_id").notNull(),
  status: text("status").notNull().default("ongoing"), // ongoing, resolved
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ==========================================
// 3. ERP「LedgerWorks」Tables
// ==========================================

export const erpItems = sqliteTable("erp_items", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  unit: text("unit").notNull().default("PCS"),
  boxConversionRatio: integer("box_conversion_ratio").notNull().default(1),
  category: text("category").notNull().default("general"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const erpWarehouses = sqliteTable("erp_warehouses", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const erpSuppliers = sqliteTable("erp_suppliers", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  contactEmail: text("contact_email"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const erpCustomers = sqliteTable("erp_customers", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  contactEmail: text("contact_email"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const erpPurchaseOrders = sqliteTable("erp_purchase_orders", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  poNumber: text("po_number").notNull(),
  supplierId: text("supplier_id").notNull(),
  status: text("status").notNull().default("draft"), // draft, approved, rejected, fulfilled
  totalAmount: integer("total_amount").notNull().default(0), // cents
  rejectedReason: text("rejected_reason"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const erpPurchaseOrderLines = sqliteTable("erp_purchase_order_lines", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  poId: text("po_id").notNull(),
  itemId: text("item_id").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: integer("unit_price").notNull(), // cents
  receivedQuantity: integer("received_quantity").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const erpReceipts = sqliteTable("erp_receipts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  receiptNumber: text("receipt_number").notNull(),
  poId: text("po_id").notNull(),
  warehouseId: text("warehouse_id").notNull(),
  status: text("status").notNull().default("completed"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const erpReceiptLines = sqliteTable("erp_receipt_lines", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  receiptId: text("receipt_id").notNull(),
  itemId: text("item_id").notNull(),
  quantity: integer("quantity").notNull(),
  unitCost: integer("unit_cost").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const erpSalesOrders = sqliteTable("erp_sales_orders", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  soNumber: text("so_number").notNull(),
  customerId: text("customer_id").notNull(),
  quoteReference: text("quote_reference"),
  status: text("status").notNull().default("draft"), // draft, confirmed, partially_shipped, shipped, cancelled
  totalAmount: integer("total_amount").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const erpSalesOrderLines = sqliteTable("erp_sales_order_lines", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  soId: text("so_id").notNull(),
  itemId: text("item_id").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: integer("unit_price").notNull(),
  shippedQuantity: integer("shipped_quantity").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const erpShipments = sqliteTable("erp_shipments", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  shipmentNumber: text("shipment_number").notNull(),
  soId: text("so_id").notNull(),
  warehouseId: text("warehouse_id").notNull(),
  status: text("status").notNull().default("completed"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const erpShipmentLines = sqliteTable("erp_shipment_lines", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  shipmentId: text("shipment_id").notNull(),
  itemId: text("item_id").notNull(),
  quantity: integer("quantity").notNull(),
  unitCost: integer("unit_cost").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const erpStockLedger = sqliteTable("erp_stock_ledger", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  itemId: text("item_id").notNull(),
  warehouseId: text("warehouse_id").notNull(),
  changeType: text("change_type").notNull(), // purchase_receipt, purchase_return, sales_shipment, transfer_in, transfer_out, adjustment
  quantityChange: integer("quantity_change").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  unitCost: integer("unit_cost").notNull().default(0),
  totalValue: integer("total_value").notNull().default(0),
  referenceDoc: text("reference_doc").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const erpItemCosting = sqliteTable("erp_item_costing", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  itemId: text("item_id").notNull(),
  totalQuantity: integer("total_quantity").notNull().default(0),
  totalCost: integer("total_cost").notNull().default(0),
  movingAverageCost: integer("moving_average_cost").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const erpInvoices = sqliteTable("erp_invoices", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceType: text("invoice_type").notNull(), // payable, receivable
  partnerType: text("partner_type").notNull(), // supplier, customer
  partnerId: text("partner_id").notNull(),
  totalAmount: integer("total_amount").notNull(),
  paidAmount: integer("paid_amount").notNull().default(0),
  status: text("status").notNull().default("unpaid"), // unpaid, partially_paid, paid
  dueDate: text("due_date"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const erpPayments = sqliteTable("erp_payments", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  paymentNumber: text("payment_number").notNull(),
  invoiceId: text("invoice_id").notNull(),
  amount: integer("amount").notNull(),
  paymentMethod: text("payment_method").notNull().default("bank_transfer"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const erpJournalEntries = sqliteTable("erp_journal_entries", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  entryNumber: text("entry_number").notNull(),
  entryDate: text("entry_date").notNull(),
  description: text("description").notNull(),
  referenceDoc: text("reference_doc"),
  status: text("status").notNull().default("posted"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const erpJournalLines = sqliteTable("erp_journal_lines", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  journalId: text("journal_id").notNull(),
  accountCode: text("account_code").notNull(),
  accountName: text("account_name").notNull(),
  debitAmount: integer("debit_amount").notNull().default(0),
  creditAmount: integer("credit_amount").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const erpFiscalPeriods = sqliteTable("erp_fiscal_periods", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  periodCode: text("period_code").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  isClosed: integer("is_closed", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ==========================================
// 4. POS「CounterPoint」Tables
// ==========================================

export const posStores = sqliteTable("pos_stores", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  address: text("address"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const posRegisters = sqliteTable("pos_registers", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  storeId: text("store_id").notNull(),
  registerNumber: text("register_number").notNull(),
  name: text("name").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const posShifts = sqliteTable("pos_shifts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  storeId: text("store_id").notNull(),
  registerId: text("register_id").notNull(),
  cashierId: text("cashier_id").notNull(),
  openingCash: integer("opening_cash").notNull(),
  closingCash: integer("closing_cash"),
  expectedCash: integer("expected_cash"),
  cashDiscrepancy: integer("cash_discrepancy"),
  status: text("status").notNull().default("open"), // open, closed
  openedAt: text("opened_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  closedAt: text("closed_at"),
  notes: text("notes"),
});

export const posCatalogItems = sqliteTable("pos_catalog_items", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  barcode: text("barcode").notNull(),
  name: text("name").notNull(),
  price: integer("price").notNull(),
  stockQuantity: integer("stock_quantity").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const posHeldCarts = sqliteTable("pos_held_carts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  storeId: text("store_id").notNull(),
  cartName: text("cart_name").notNull(),
  itemsJson: text("items_json").notNull(),
  status: text("status").notNull().default("held"), // held, retrieved, cancelled
  lockedBy: text("locked_by"),
  heldAt: text("held_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const posSales = sqliteTable("pos_sales", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  receiptNumber: text("receipt_number").notNull(),
  storeId: text("store_id").notNull(),
  registerId: text("register_id").notNull(),
  shiftId: text("shift_id").notNull(),
  cashierId: text("cashier_id").notNull(),
  customerId: text("customer_id"),
  subtotal: integer("subtotal").notNull(),
  discountAmount: integer("discount_amount").notNull().default(0),
  taxAmount: integer("tax_amount").notNull().default(0),
  totalAmount: integer("total_amount").notNull(),
  tenderAmount: integer("tender_amount").notNull(),
  changeAmount: integer("change_amount").notNull().default(0),
  paymentMethod: text("payment_method").notNull().default("cash"),
  status: text("status").notNull().default("completed"), // completed, refunded, partially_refunded
  isReprint: integer("is_reprint", { mode: "boolean" }).notNull().default(false),
  idempotencyKey: text("idempotency_key"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const posSaleLines = sqliteTable("pos_sale_lines", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  saleId: text("sale_id").notNull(),
  itemId: text("item_id").notNull(),
  barcode: text("barcode").notNull(),
  name: text("name").notNull(),
  unitPrice: integer("unit_price").notNull(),
  quantity: integer("quantity").notNull(),
  discountAmount: integer("discount_amount").notNull().default(0),
  lineTotal: integer("line_total").notNull(),
  refundedQuantity: integer("refunded_quantity").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const posRefunds = sqliteTable("pos_refunds", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  refundNumber: text("refund_number").notNull(),
  originalSaleId: text("original_sale_id").notNull(),
  managerId: text("manager_id").notNull(),
  reason: text("reason").notNull(),
  refundAmount: integer("refund_amount").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const posRefundLines = sqliteTable("pos_refund_lines", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  refundId: text("refund_id").notNull(),
  saleLineId: text("sale_line_id").notNull(),
  quantity: integer("quantity").notNull(),
  amount: integer("amount").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const posCashMovements = sqliteTable("pos_cash_movements", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  shiftId: text("shift_id").notNull(),
  movementType: text("movement_type").notNull(), // pay_in, pay_out
  amount: integer("amount").notNull(),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ==========================================
// 5. CRM「RelationDesk」Tables
// ==========================================

export const crmAccounts = sqliteTable("crm_accounts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  industry: text("industry"),
  phone: text("phone"),
  email: text("email"),
  ownerId: text("owner_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const crmContacts = sqliteTable("crm_contacts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  accountId: text("account_id"),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  title: text("title"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const crmLeads = sqliteTable("crm_leads", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  company: text("company"),
  email: text("email").notNull(),
  phone: text("phone"),
  status: text("status").notNull().default("new"), // new, assigned, contacted, qualified, converted, disqualified
  assignedTo: text("assigned_to"),
  convertedAccountId: text("converted_account_id"),
  convertedContactId: text("converted_contact_id"),
  convertedOpportunityId: text("converted_opportunity_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const crmStages = sqliteTable("crm_stages", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  probability: integer("probability").notNull(),
  isWon: integer("is_won", { mode: "boolean" }).notNull().default(false),
  isLost: integer("is_lost", { mode: "boolean" }).notNull().default(false),
});

export const crmOpportunities = sqliteTable("crm_opportunities", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  accountId: text("account_id"),
  primaryContactId: text("primary_contact_id"),
  ownerId: text("owner_id").notNull(),
  stageId: text("stage_id").notNull(),
  amount: integer("amount").notNull().default(0),
  weightedAmount: integer("weighted_amount").notNull().default(0),
  probability: integer("probability").notNull().default(0),
  closeDate: text("close_date"),
  status: text("status").notNull().default("open"), // open, won, lost
  lossReason: text("loss_reason"),
  wonReason: text("won_reason"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const crmActivities = sqliteTable("crm_activities", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  activityType: text("activity_type").notNull(), // call, meeting, task, email
  subject: text("subject").notNull(),
  dueDate: text("due_date").notNull(),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  completedAt: text("completed_at"),
  ownerId: text("owner_id").notNull(),
  accountId: text("account_id"),
  contactId: text("contact_id"),
  opportunityId: text("opportunity_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const crmQuotes = sqliteTable("crm_quotes", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  quoteNumber: text("quote_number").notNull(),
  opportunityId: text("opportunity_id").notNull(),
  version: integer("version").notNull().default(1),
  totalAmount: integer("total_amount").notNull().default(0),
  status: text("status").notNull().default("draft"), // draft, submitted, approved, rejected
  isLocked: integer("is_locked", { mode: "boolean" }).notNull().default(false),
  approvedAt: text("approved_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const crmQuoteItems = sqliteTable("crm_quote_items", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  quoteId: text("quote_id").notNull(),
  itemName: text("item_name").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: integer("unit_price").notNull(),
  lineTotal: integer("line_total").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const crmTickets = sqliteTable("crm_tickets", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  ticketNumber: text("ticket_number").notNull(),
  customerId: text("customer_id"),
  contactId: text("contact_id"),
  subject: text("subject").notNull(),
  priority: text("priority").notNull().default("medium"), // low, medium, high, urgent
  status: text("status").notNull().default("new"), // new, in_progress, resolved, reopened
  slaHours: integer("sla_hours").notNull().default(24),
  isSlaBreached: integer("is_sla_breached", { mode: "boolean" }).notNull().default(false),
  resolvedAt: text("resolved_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const crmConsents = sqliteTable("crm_consents", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  contactId: text("contact_id").notNull(),
  email: text("email").notNull(),
  marketingEmailAllowed: integer("marketing_email_allowed", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ==========================================
// 6. Dining「TableCraft」Tables
// ==========================================

export const diningLocations = sqliteTable("dining_locations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  serviceFeeRate: integer("service_fee_rate").notNull().default(10),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const diningTables = sqliteTable("dining_tables", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  locationId: text("location_id").notNull(),
  tableNumber: text("table_number").notNull(),
  capacity: integer("capacity").notNull(),
  status: text("status").notNull().default("vacant"), // vacant, occupied, reserved, cleaning
  zone: text("zone").notNull().default("main"), // main, window, vip, bar
  shape: text("shape").notNull().default("square"), // square, round, rectangle, bar
  coordX: integer("coord_x").notNull().default(0),
  coordY: integer("coord_y").notNull().default(0),
  cleanedUntil: text("cleaned_until"), // 5-minute cleaning deadline timestamp (ISO)
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const diningReservations = sqliteTable("dining_reservations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  locationId: text("location_id").notNull(),
  tableId: text("table_id").notNull(),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull(),
  guestCount: integer("guest_count").notNull(),
  reservationTime: text("reservation_time").notNull(),
  status: text("status").notNull().default("confirmed"), // confirmed, seated, cancelled
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const diningMenuItems = sqliteTable("dining_menu_items", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  price: integer("price").notNull(),
  isSoldOut: integer("is_sold_out", { mode: "boolean" }).notNull().default(false),
  station: text("station").notNull().default("hot_kitchen"), // hot_kitchen, cold_bar, grill, dessert
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const diningModifierGroups = sqliteTable("dining_modifier_groups", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  minSelection: integer("min_selection").notNull().default(0),
  maxSelection: integer("max_selection").notNull().default(1),
  isRequired: integer("is_required", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const diningModifierOptions = sqliteTable("dining_modifier_options", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  groupId: text("group_id").notNull(),
  name: text("name").notNull(),
  additionalPrice: integer("additional_price").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const diningTableSessions = sqliteTable("dining_table_sessions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  tableId: text("table_id").notNull(),
  sessionToken: text("session_token").notNull().unique(),
  guestCount: integer("guest_count").notNull().default(2),
  status: text("status").notNull().default("active"), // active, billed, closed
  openedAt: text("opened_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  closedAt: text("closed_at"),
  durationMinutes: integer("duration_minutes"),
});

export const diningOrders = sqliteTable("dining_orders", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  sessionId: text("session_id"),
  orderType: text("order_type").notNull().default("dine_in"), // dine_in, takeout
  takeoutNumber: text("takeout_number"),
  subtotal: integer("subtotal").notNull(),
  serviceCharge: integer("service_charge").notNull().default(0),
  totalAmount: integer("total_amount").notNull(),
  status: text("status").notNull().default("placed"), // placed, preparing, served, completed, cancelled
  idempotencyKey: text("idempotency_key"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [uniqueIndex("dining_orders_takeout_number_unique").on(table.organizationId, table.takeoutNumber)]);

export const diningOrderItems = sqliteTable("dining_order_items", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  orderId: text("order_id").notNull(),
  menuItemId: text("menu_item_id").notNull(),
  itemName: text("item_name").notNull(),
  unitPrice: integer("unit_price").notNull(),
  quantity: integer("quantity").notNull(),
  modifiersJson: text("modifiers_json"),
  lineTotal: integer("line_total").notNull(),
  status: text("status").notNull().default("pending"), // pending, preparing, ready, served, cancelled
  cancelledReason: text("cancelled_reason"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const diningKitchenTickets = sqliteTable("dining_kitchen_tickets", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  orderId: text("order_id").notNull(),
  orderItemId: text("order_item_id").notNull(),
  station: text("station").notNull(),
  itemName: text("item_name").notNull(),
  quantity: integer("quantity").notNull(),
  modifiersText: text("modifiers_text"),
  status: text("status").notNull().default("received"), // received, cooking, done, served
  urgentFlag: integer("urgent_flag", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const diningBills = sqliteTable("dining_bills", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  sessionId: text("session_id"),
  orderId: text("order_id").unique(), // Direct link for a prepaid takeout order.
  subtotal: integer("subtotal").notNull(),
  serviceCharge: integer("service_charge").notNull().default(0),
  discountAmount: integer("discount_amount").notNull().default(0),
  finalAmount: integer("final_amount").notNull(),
  paidAmount: integer("paid_amount").notNull().default(0),
  status: text("status").notNull().default("unpaid"), // unpaid, partially_paid, paid
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const diningPayments = sqliteTable("dining_payments", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  billId: text("bill_id").notNull(),
  amount: integer("amount").notNull(),
  paymentMethod: text("payment_method").notNull().default("cash"),
  splitIndex: integer("split_index").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ==========================================
// 7. Commerce「MarketLane」Tables
// ==========================================

export const shopCategories = sqliteTable("shop_categories", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const shopProducts = sqliteTable("shop_products", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  categoryId: text("category_id").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const shopVariants = sqliteTable("shop_variants", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  productId: text("product_id").notNull(),
  sku: text("sku").notNull(),
  title: text("title").notNull(),
  color: text("color"),
  size: text("size"),
  price: integer("price").notNull(),
  stockQuantity: integer("stock_quantity").notNull().default(0),
  reservedQuantity: integer("reserved_quantity").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const shopInventoryReservations = sqliteTable("shop_inventory_reservations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  variantId: text("variant_id").notNull(),
  sessionId: text("session_id").notNull(),
  cartId: text("cart_id"),
  quantity: integer("quantity").notNull(),
  expiresAt: text("expires_at").notNull(),
  status: text("status").notNull().default("active"), // active, consumed, expired
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const shopCarts = sqliteTable("shop_carts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  sessionId: text("session_id").notNull(),
  userId: text("user_id"),
  couponCode: text("coupon_code"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const shopCartItems = sqliteTable("shop_cart_items", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  cartId: text("cart_id").notNull(),
  variantId: text("variant_id").notNull(),
  quantity: integer("quantity").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const shopPromotions = sqliteTable("shop_promotions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  code: text("code").notNull(),
  description: text("description"),
  discountType: text("discount_type").notNull().default("percentage"), // percentage, fixed
  discountValue: integer("discount_value").notNull(),
  minSpend: integer("min_spend").notNull().default(0),
  expiresAt: text("expires_at"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const shopOrders = sqliteTable("shop_orders", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  orderNumber: text("order_number").notNull(),
  userId: text("user_id"),
  customerEmail: text("customer_email").notNull(),
  shippingAddressJson: text("shipping_address_json").notNull(),
  subtotal: integer("subtotal").notNull(),
  discountAmount: integer("discount_amount").notNull().default(0),
  shippingFee: integer("shipping_fee").notNull().default(0),
  totalAmount: integer("total_amount").notNull(),
  paymentStatus: text("payment_status").notNull().default("pending"), // pending, paid, failed, refunded
  fulfillmentStatus: text("fulfillment_status").notNull().default("unfulfilled"), // unfulfilled, partially_shipped, shipped, delivered
  trackingNumber: text("tracking_number"),
  idempotencyKey: text("idempotency_key"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const shopOrderItems = sqliteTable("shop_order_items", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  orderId: text("order_id").notNull(),
  variantId: text("variant_id").notNull(),
  productName: text("product_name").notNull(),
  variantTitle: text("variant_title").notNull(),
  sku: text("sku").notNull(),
  unitPrice: integer("unit_price").notNull(),
  quantity: integer("quantity").notNull(),
  lineTotal: integer("line_total").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const shopPaymentAttempts = sqliteTable("shop_payment_attempts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  orderId: text("order_id").notNull(),
  attemptReference: text("attempt_reference").notNull(),
  amount: integer("amount").notNull(),
  provider: text("provider").notNull().default("mock_gateway"),
  status: text("status").notNull().default("pending"), // pending, success, failed, timed_out
  callbackPayload: text("callback_payload"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const shopShipments = sqliteTable("shop_shipments", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  orderId: text("order_id").notNull(),
  trackingNumber: text("tracking_number").notNull(),
  carrier: text("carrier").notNull().default("Standard Logistics"),
  status: text("status").notNull().default("shipped"),
  shippedAt: text("shipped_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const shopReturns = sqliteTable("shop_returns", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  orderId: text("order_id").notNull(),
  orderItemId: text("order_item_id").notNull(),
  quantity: integer("quantity").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("requested"), // requested, approved, received, refunded
  refundAmount: integer("refund_amount").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const shopReviews = sqliteTable("shop_reviews", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  productId: text("product_id").notNull(),
  userId: text("user_id").notNull(),
  orderId: text("order_id").notNull(),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  isVisible: integer("is_visible", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const demoSeedStates = sqliteTable("demo_seed_states", { organizationId: text("organization_id").primaryKey(), readyAt: text("ready_at").notNull().default(sql`CURRENT_TIMESTAMP`) });
