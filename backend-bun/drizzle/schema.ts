import { pgTable, varchar, uniqueIndex, index, foreignKey, serial, integer, timestamp, numeric, unique, check, boolean, text, date, jsonb, json, primaryKey, pgEnum, customType } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

// Fallback for bytea columns that drizzle-kit introspect couldn't map.
const bytea = customType<{ data: Buffer; default: false }>({
	dataType() {
		return "bytea";
	},
});

export const approvalrequesttype = pgEnum("approvalrequesttype", ['BUDGET_OVERRIDE', 'DISCOUNT', 'RETURN', 'VOID', 'PRICE_OVERRIDE'])
export const approvalstatus = pgEnum("approvalstatus", ['PENDING', 'APPROVED', 'REJECTED'])
export const auditaction = pgEnum("auditaction", ['CREATE', 'UPDATE', 'DELETE', 'RETURN', 'EXCHANGE', 'CANCEL', 'VOID', 'REPRINT', 'APPROVE', 'REJECT'])
export const budgettransactiontype = pgEnum("budgettransactiontype", ['ALLOCATION', 'DEDUCTION', 'ADJUSTMENT'])
export const creditnotestatus = pgEnum("creditnotestatus", ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED'])
export const customertypeenum = pgEnum("customertypeenum", ['PUBLIC', 'INTERNAL'])
export const movementtype = pgEnum("movementtype", ['receive', 'sale', 'adjustment', 'internal_use', 'void', 'exchange'])
export const optionselectiontype = pgEnum("optionselectiontype", ['single', 'multi', 'quantity'])
export const paymentintentstatus = pgEnum("paymentintentstatus", ['pending', 'confirmed', 'cancelled'])
export const paymentmethod = pgEnum("paymentmethod", ['CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'WALLET', 'BANK_TRANSFER', 'CARD_TAP', 'EDC', 'DEPARTMENT', 'OTHER', 'QR_PROMPTPAY'])
export const receiptstatus = pgEnum("receiptstatus", ['ACTIVE', 'VOIDED'])
export const refundtype = pgEnum("refundtype", ['PRODUCT', 'WALLET', 'CASH'])
export const returnstatus = pgEnum("returnstatus", ['pending', 'approved', 'rejected'])
export const shoptype = pgEnum("shoptype", ['avg_cost', 'fifo'])
export const transactionmode = pgEnum("transactionmode", ['SALE', 'INTERNAL_ISSUE'])
export const transactiontype = pgEnum("transactiontype", ['SALE', 'RETURN', 'ADJUSTMENT', 'INTERNAL_ISSUE', 'INITIAL'])
export const wallettransactiontype = pgEnum("wallettransactiontype", ['TOPUP', 'DEDUCTION', 'REFUND', 'ADJUSTMENT'])


export const alembicVersion = pgTable("alembic_version", {
	versionNum: varchar("version_num", { length: 32 }).primaryKey().notNull(),
});

export const creditNotes = pgTable("credit_notes", {
	id: serial().primaryKey().notNull(),
	creditNoteNumber: varchar("credit_note_number", { length: 50 }).notNull(),
	originalReceiptId: integer("original_receipt_id"),
	creditDate: timestamp("credit_date", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	totalCreditAmount: numeric("total_credit_amount", { precision: 10, scale:  2 }).notNull(),
	refundType: refundtype("refund_type").notNull(),
	status: creditnotestatus().notNull(),
	reason: varchar({ length: 500 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdBy: integer("created_by").notNull(),
	approvedAt: timestamp("approved_at", { withTimezone: true, mode: 'string' }),
	approvedBy: integer("approved_by"),
}, (table) => [
	uniqueIndex("ix_credit_notes_credit_note_number").using("btree", table.creditNoteNumber.asc().nullsLast().op("text_ops")),
	index("ix_credit_notes_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.approvedBy],
			foreignColumns: [users.id],
			name: "credit_notes_approved_by_fkey"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "credit_notes_created_by_fkey"
		}),
	foreignKey({
			columns: [table.originalReceiptId],
			foreignColumns: [receipts.id],
			name: "credit_notes_original_receipt_id_fkey"
		}),
]);

export const wallets = pgTable("wallets", {
	id: serial().primaryKey().notNull(),
	customerId: integer("customer_id"),
	userId: integer("user_id"),
	departmentId: integer("department_id"),
	balance: numeric({ precision: 10, scale:  2 }).notNull(),
	isActive: boolean("is_active").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	uniqueIndex("ix_wallets_department_id").using("btree", table.departmentId.asc().nullsLast().op("int4_ops")),
	index("ix_wallets_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	uniqueIndex("ix_wallets_user_id").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "wallets_customer_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.departmentId],
			foreignColumns: [departments.id],
			name: "wallets_department_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "wallets_user_id_fkey"
		}).onDelete("set null"),
	unique("wallets_customer_id_key").on(table.customerId),
	check("chk_wallet_owner", sql`((((customer_id IS NOT NULL))::integer + ((user_id IS NOT NULL))::integer) + ((department_id IS NOT NULL))::integer) = 1`),
]);

export const userLoginEmails = pgTable("user_login_emails", {
	id: serial().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	email: varchar({ length: 255 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Which sync channel registered this row ("staff" | "family") — NULL for
	// rows that pre-date this column. See ensure_schema.ts for why this needs
	// to stay scoped per-channel.
	source: varchar({ length: 20 }),
}, (table) => [
	uniqueIndex("ix_user_login_emails_email").using("btree", table.email.asc().nullsLast().op("text_ops")),
	index("ix_user_login_emails_user_id").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_login_emails_user_id_fkey"
		}).onDelete("cascade"),
]);

export const customerTypes = pgTable("customer_types", {
	id: serial().primaryKey().notNull(),
	typeName: customertypeenum("type_name").notNull(),
	description: varchar({ length: 255 }),
	defaultPriceLevel: varchar("default_price_level", { length: 50 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_customer_types_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	unique("customer_types_type_name_key").on(table.typeName),
]);

export const customers = pgTable("customers", {
	id: serial().primaryKey().notNull(),
	customerCode: varchar("customer_code", { length: 50 }).notNull(),
	name: varchar({ length: 255 }).notNull(),
	photoUrl: varchar("photo_url", { length: 500 }),
	customerTypeId: integer("customer_type_id").notNull(),
	departmentId: integer("department_id"),
	email: varchar({ length: 255 }),
	phone: varchar({ length: 20 }),
	isActive: boolean("is_active").notNull(),
	studentCode: varchar("student_code", { length: 20 }),
	grade: varchar({ length: 20 }),
	allergies: text(),
	dietaryNotes: text("dietary_notes"),
	cardUid: varchar("card_uid", { length: 50 }),
	cardFrozen: boolean("card_frozen").notNull(),
	dailyLimit: numeric("daily_limit", { precision: 10, scale:  2 }),
	negativeCreditLimit: numeric("negative_credit_limit", { precision: 10, scale:  2 }),
	allergyOverrideNote: text("allergy_override_note"),
	powerschoolSyncAt: timestamp("powerschool_sync_at", { withTimezone: true, mode: 'string' }),
	familyCode: varchar("family_code", { length: 20 }),
	externalId: varchar("external_id", { length: 50 }),
	customerType: varchar("customer_type", { length: 20 }),
	schoolType: varchar("school_type", { length: 20 }),
	customerKind: varchar("customer_kind", { length: 20 }).default('other').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	isGraduated: boolean("is_graduated").default(false).notNull(),
	enrollDate: date("enroll_date"),
	withdrawDate: date("withdraw_date"),
	dailyLimitCanteen: numeric("daily_limit_canteen", { precision: 10, scale:  2 }),
	dailyLimitStore: numeric("daily_limit_store", { precision: 10, scale:  2 }),
}, (table) => [
	uniqueIndex("ix_customers_card_uid").using("btree", table.cardUid.asc().nullsLast().op("text_ops")),
	uniqueIndex("ix_customers_customer_code").using("btree", table.customerCode.asc().nullsLast().op("text_ops")),
	index("ix_customers_customer_kind").using("btree", table.customerKind.asc().nullsLast().op("text_ops")),
	uniqueIndex("ix_customers_external_id").using("btree", table.externalId.asc().nullsLast().op("text_ops")),
	index("ix_customers_family_code").using("btree", table.familyCode.asc().nullsLast().op("text_ops")),
	index("ix_customers_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	index("ix_customers_kind").using("btree", table.customerKind.asc().nullsLast().op("text_ops")),
	uniqueIndex("ix_customers_student_code").using("btree", table.studentCode.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.customerTypeId],
			foreignColumns: [customerTypes.id],
			name: "customers_customer_type_id_fkey"
		}),
	foreignKey({
			columns: [table.departmentId],
			foreignColumns: [departments.id],
			name: "customers_department_id_fkey"
		}),
]);

export const departments = pgTable("departments", {
	id: serial().primaryKey().notNull(),
	departmentCode: varchar("department_code", { length: 50 }).notNull(),
	departmentName: varchar("department_name", { length: 255 }).notNull(),
	annualBudget: numeric("annual_budget", { precision: 12, scale:  2 }).notNull(),
	currentYear: integer("current_year").notNull(),
	isActive: boolean("is_active").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	// Touched ONLY by processDepartmentBatch (ISB sync) — admin's own
	// updateDepartment() never sets this, so department_sweep_service.ts can
	// tell "ISB stopped reporting this department" apart from "an admin just
	// edited its name/active flag by hand".
	lastSyncedAt: timestamp("last_synced_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	uniqueIndex("ix_departments_department_code").using("btree", table.departmentCode.asc().nullsLast().op("text_ops")),
	index("ix_departments_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
]);

export const permissions = pgTable("permissions", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	resource: varchar({ length: 50 }).notNull(),
	action: varchar({ length: 50 }).notNull(),
	description: varchar({ length: 255 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_permissions_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	unique("permissions_name_key").on(table.name),
]);

export const paymentIntents = pgTable("payment_intents", {
	id: serial().primaryKey().notNull(),
	refCode: varchar("ref_code", { length: 50 }).notNull(),
	// wallet_id is null for POS-sale intents (intent_type='pos_sale')
	walletId: integer("wallet_id"),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	qrPayload: text("qr_payload"),
	status: paymentintentstatus().notNull(),
	paymentMethod: varchar("payment_method", { length: 30 }).notNull(),
	confirmedVia: varchar("confirmed_via", { length: 30 }),
	createdBy: integer("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: 'string' }),
	confirmedBy: integer("confirmed_by"),
	notes: varchar({ length: 500 }),
	txnNo: varchar("txn_no", { length: 100 }),
	// Discriminator: 'wallet_topup' (default) or 'pos_sale'
	intentType: varchar("intent_type", { length: 20 }).default('wallet_topup'),
	// POS-sale only: full cart payload so the webhook can create a receipt
	// without the cashier round-tripping back. Shape mirrors CheckoutInput.
	cartSnapshot: jsonb("cart_snapshot"),
	// POS-sale only: FK to the receipt created after the webhook confirms.
	receiptId: integer("receipt_id"),
	actingUserId: integer("acting_user_id"),
	actingCustomerId: integer("acting_customer_id"),
}, (table) => [
	index("ix_payment_intents_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	index("ix_payment_intents_intent_type").using("btree", table.intentType.asc().nullsLast().op("text_ops")),
	index("ix_payment_intents_ref").using("btree", table.refCode.asc().nullsLast().op("text_ops")),
	uniqueIndex("ix_payment_intents_ref_code").using("btree", table.refCode.asc().nullsLast().op("text_ops")),
	index("ix_payment_intents_txn_no").using("btree", table.txnNo.asc().nullsLast().op("text_ops")),
	index("ix_payment_intents_wallet").using("btree", table.walletId.asc().nullsLast().op("int4_ops")),
	index("ix_payment_intents_wallet_id").using("btree", table.walletId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.confirmedBy],
			foreignColumns: [users.id],
			name: "payment_intents_confirmed_by_fkey"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "payment_intents_created_by_fkey"
		}),
	foreignKey({
			columns: [table.walletId],
			foreignColumns: [wallets.id],
			name: "payment_intents_wallet_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.actingUserId],
			foreignColumns: [users.id],
			name: "payment_intents_acting_user_id_fkey"
		}),
	foreignKey({
			columns: [table.actingCustomerId],
			foreignColumns: [customers.id],
			name: "payment_intents_acting_customer_id_fkey"
		}),
]);

export const receiptItems = pgTable("receipt_items", {
	id: serial().primaryKey().notNull(),
	receiptId: integer("receipt_id").notNull(),
	productVariantId: integer("product_variant_id").notNull(),
	quantity: integer().notNull(),
	unitPrice: numeric("unit_price", { precision: 10, scale:  2 }).notNull(),
	priceOverride: numeric("price_override", { precision: 10, scale:  2 }),
	discount: numeric({ precision: 10, scale:  2 }).notNull(),
	lineTotal: numeric("line_total", { precision: 10, scale:  2 }).notNull(),
	options: json(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("ix_receipt_items_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.productVariantId],
			foreignColumns: [shopProducts.id],
			name: "receipt_items_product_variant_id_fkey"
		}),
	foreignKey({
			columns: [table.receiptId],
			foreignColumns: [receipts.id],
			name: "receipt_items_receipt_id_fkey"
		}).onDelete("cascade"),
]);

export const emailAlertsLog = pgTable("email_alerts_log", {
	id: serial().primaryKey().notNull(),
	alertType: varchar("alert_type", { length: 40 }).notNull(),
	recipientEmail: varchar("recipient_email", { length: 255 }).notNull(),
	parentUserId: integer("parent_user_id"),
	childCustomerId: integer("child_customer_id"),
	subject: varchar({ length: 500 }).notNull(),
	thresholdAmount: numeric("threshold_amount", { precision: 10, scale:  2 }),
	balanceAtAlert: numeric("balance_at_alert", { precision: 10, scale:  2 }),
	status: varchar({ length: 20 }).notNull(),
	errorMessage: text("error_message"),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_email_alerts_log_alert_type").using("btree", table.alertType.asc().nullsLast().op("text_ops")),
	index("ix_email_alerts_log_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	index("ix_email_alerts_log_sent_at").using("btree", table.sentAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.childCustomerId],
			foreignColumns: [customers.id],
			name: "email_alerts_log_child_customer_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.parentUserId],
			foreignColumns: [users.id],
			name: "email_alerts_log_parent_user_id_fkey"
		}).onDelete("set null"),
]);

export const parentChildLinks = pgTable("parent_child_links", {
	id: serial().primaryKey().notNull(),
	parentUserId: integer("parent_user_id").notNull(),
	childCustomerId: integer("child_customer_id").notNull(),
	relation: varchar({ length: 20 }).notNull(),
	parentRank: varchar("parent_rank", { length: 10 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lowBalanceThreshold: numeric("low_balance_threshold", { precision: 10, scale:  2 }),
	lowBalanceAlertEnabled: boolean("low_balance_alert_enabled").default(false).notNull(),
	lastLowBalanceAlertAt: timestamp("last_low_balance_alert_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("ix_parent_child_child").using("btree", table.childCustomerId.asc().nullsLast().op("int4_ops")),
	index("ix_parent_child_links_child_customer_id").using("btree", table.childCustomerId.asc().nullsLast().op("int4_ops")),
	index("ix_parent_child_links_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	index("ix_parent_child_links_parent_user_id").using("btree", table.parentUserId.asc().nullsLast().op("int4_ops")),
	index("ix_parent_child_parent").using("btree", table.parentUserId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.childCustomerId],
			foreignColumns: [customers.id],
			name: "parent_child_links_child_customer_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.parentUserId],
			foreignColumns: [users.id],
			name: "parent_child_links_parent_user_id_fkey"
		}).onDelete("cascade"),
	unique("uq_parent_child").on(table.childCustomerId, table.parentUserId),
]);

export const shopProducts = pgTable("shop_products", {
	id: serial().primaryKey().notNull(),
	shopId: varchar("shop_id", { length: 50 }).notNull(),
	productCode: varchar("product_code", { length: 50 }).notNull(),
	barcode: varchar({ length: 100 }),
	name: varchar({ length: 255 }).notNull(),
	category: varchar({ length: 100 }).notNull(),
	externalPrice: numeric("external_price", { precision: 10, scale:  2 }).notNull(),
	internalPrice: numeric("internal_price", { precision: 10, scale:  2 }).notNull(),
	vatPercent: numeric("vat_percent", { precision: 5, scale:  2 }).notNull(),
	avgCost: numeric("avg_cost", { precision: 10, scale:  4 }).notNull(),
	stock: integer().notNull(),
	minStock: integer("min_stock").notNull(),
	isActive: boolean("is_active").notNull(),
	photoUrl: varchar("photo_url", { length: 500 }),
	color: varchar({ length: 50 }),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	uomId: integer("uom_id"),
	shortName: varchar("short_name", { length: 100 }),
}, (table) => [
	index("ix_shop_products_barcode").using("btree", table.barcode.asc().nullsLast().op("text_ops")),
	index("ix_shop_products_name").using("btree", table.name.asc().nullsLast().op("text_ops")),
	index("ix_shop_products_shop_id").using("btree", table.shopId.asc().nullsLast().op("text_ops")),
	index("ix_shop_products_sort").using("btree", table.shopId.asc().nullsLast().op("text_ops"), table.sortOrder.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.shopId],
			foreignColumns: [shops.id],
			name: "shop_products_shop_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.uomId],
			foreignColumns: [unitsOfMeasure.id],
			name: "shop_products_uom_id_fkey"
		}),
]);

export const unitsOfMeasure = pgTable("units_of_measure", {
	id: serial().primaryKey().notNull(),
	code: varchar({ length: 20 }).notNull(),
	name: varchar({ length: 100 }).notNull(),
	nameEn: varchar("name_en", { length: 100 }),
	baseUomId: integer("base_uom_id"),
	conversionFactor: numeric("conversion_factor", { precision: 10, scale:  4 }).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	uniqueIndex("ix_units_of_measure_code").using("btree", table.code.asc().nullsLast().op("text_ops")),
	index("ix_uom_code").using("btree", table.code.asc().nullsLast().op("text_ops")),
]);

export const bundleItems = pgTable("bundle_items", {
	id: serial().primaryKey().notNull(),
	bundleId: integer("bundle_id").notNull(),
	productId: integer("product_id").notNull(),
	quantity: integer().notNull(),
	sortOrder: integer("sort_order").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_bundle_items_bundle").using("btree", table.bundleId.asc().nullsLast().op("int4_ops")),
	index("ix_bundle_items_bundle_id").using("btree", table.bundleId.asc().nullsLast().op("int4_ops")),
	index("ix_bundle_items_product").using("btree", table.productId.asc().nullsLast().op("int4_ops")),
	index("ix_bundle_items_product_id").using("btree", table.productId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.bundleId],
			foreignColumns: [productBundles.id],
			name: "bundle_items_bundle_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [shopProducts.id],
			name: "bundle_items_product_id_fkey"
		}).onDelete("cascade"),
]);

export const fifoLots = pgTable("fifo_lots", {
	id: varchar({ length: 100 }).primaryKey().notNull(),
	productId: integer("product_id").notNull(),
	shopId: varchar("shop_id", { length: 50 }).notNull(),
	date: date().notNull(),
	qtyRemaining: numeric("qty_remaining", { precision: 10, scale:  4 }).notNull(),
	costPerUnit: numeric("cost_per_unit", { precision: 10, scale:  4 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_fifo_lots_product_id").using("btree", table.productId.asc().nullsLast().op("int4_ops")),
	index("ix_fifo_lots_shop_id").using("btree", table.shopId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [shopProducts.id],
			name: "fifo_lots_product_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.shopId],
			foreignColumns: [shops.id],
			name: "fifo_lots_shop_id_fkey"
		}).onDelete("cascade"),
]);

export const menuOptionGroups = pgTable("menu_option_groups", {
	id: serial().primaryKey().notNull(),
	productId: integer("product_id").notNull(),
	name: varchar({ length: 100 }).notNull(),
	selectionType: optionselectiontype("selection_type").notNull(),
	isRequired: boolean("is_required").notNull(),
	maxSelections: integer("max_selections"),
	sortOrder: integer("sort_order").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("ix_menu_option_groups_product").using("btree", table.productId.asc().nullsLast().op("int4_ops")),
	index("ix_menu_option_groups_product_id").using("btree", table.productId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [shopProducts.id],
			name: "menu_option_groups_product_id_fkey"
		}).onDelete("cascade"),
]);

export const pricePanelItems = pgTable("price_panel_items", {
	id: serial().primaryKey().notNull(),
	panelId: integer("panel_id").notNull(),
	productId: integer("product_id"),
	price: numeric({ precision: 10, scale:  2 }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	shortName: varchar("short_name", { length: 100 }),
	included: boolean().default(true).notNull(),
	bundleId: integer("bundle_id"),
}, (table) => [
	index("ix_price_panel_items_bundle_id").using("btree", table.bundleId.asc().nullsLast().op("int4_ops")),
	index("ix_price_panel_items_panel_id").using("btree", table.panelId.asc().nullsLast().op("int4_ops")),
	index("ix_price_panel_items_product_id").using("btree", table.productId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.bundleId],
			foreignColumns: [productBundles.id],
			name: "price_panel_items_bundle_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.panelId],
			foreignColumns: [pricePanels.id],
			name: "price_panel_items_panel_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [shopProducts.id],
			name: "price_panel_items_product_id_fkey"
		}).onDelete("cascade"),
	unique("uq_panel_product").on(table.panelId, table.productId),
]);

export const productBarcodes = pgTable("product_barcodes", {
	id: serial().primaryKey().notNull(),
	productId: integer("product_id").notNull(),
	barcode: varchar({ length: 100 }).notNull(),
	label: varchar({ length: 100 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_product_barcodes_product").using("btree", table.productId.asc().nullsLast().op("int4_ops")),
	index("ix_product_barcodes_product_id").using("btree", table.productId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [shopProducts.id],
			name: "product_barcodes_product_id_fkey"
		}).onDelete("cascade"),
	unique("product_barcodes_barcode_key").on(table.barcode),
]);

export const stockPeriodCloseItems = pgTable("stock_period_close_items", {
	id: serial().primaryKey().notNull(),
	closeId: integer("close_id").notNull(),
	productId: integer("product_id").notNull(),
	systemQty: integer("system_qty").notNull(),
	physicalQty: integer("physical_qty"),
	varianceQty: integer("variance_qty"),
	unitCost: numeric("unit_cost", { precision: 10, scale:  4 }),
	varianceValue: numeric("variance_value", { precision: 10, scale:  4 }),
	adjustmentMovementId: integer("adjustment_movement_id"),
}, (table) => [
	index("ix_stock_period_close_items_close_id").using("btree", table.closeId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.adjustmentMovementId],
			foreignColumns: [shopMovements.id],
			name: "stock_period_close_items_adjustment_movement_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.closeId],
			foreignColumns: [stockPeriodCloses.id],
			name: "stock_period_close_items_close_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [shopProducts.id],
			name: "stock_period_close_items_product_id_fkey"
		}),
]);

export const menuOptions = pgTable("menu_options", {
	id: serial().primaryKey().notNull(),
	optionGroupId: integer("option_group_id").notNull(),
	name: varchar({ length: 100 }).notNull(),
	priceDelta: numeric("price_delta", { precision: 10, scale:  2 }).notNull(),
	sortOrder: integer("sort_order").notNull(),
}, (table) => [
	index("ix_menu_options_group").using("btree", table.optionGroupId.asc().nullsLast().op("int4_ops")),
	index("ix_menu_options_option_group_id").using("btree", table.optionGroupId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.optionGroupId],
			foreignColumns: [menuOptionGroups.id],
			name: "menu_options_option_group_id_fkey"
		}).onDelete("cascade"),
]);

export const productVariants = pgTable("product_variants", {
	id: serial().primaryKey().notNull(),
	productId: integer("product_id").notNull(),
	sku: varchar({ length: 100 }).notNull(),
	variantName: varchar("variant_name", { length: 255 }).notNull(),
	color: varchar({ length: 50 }),
	size: varchar({ length: 50 }),
	barcode: varchar({ length: 100 }),
	costPrice: numeric("cost_price", { precision: 10, scale:  2 }).notNull(),
	retailPrice: numeric("retail_price", { precision: 10, scale:  2 }).notNull(),
	imageUrl: varchar("image_url", { length: 500 }),
	isActive: boolean("is_active").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	uniqueIndex("ix_product_variants_barcode").using("btree", table.barcode.asc().nullsLast().op("text_ops")),
	index("ix_product_variants_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	uniqueIndex("ix_product_variants_sku").using("btree", table.sku.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "product_variants_product_id_fkey"
		}).onDelete("cascade"),
]);

export const barcodes = pgTable("barcodes", {
	id: serial().primaryKey().notNull(),
	barcode: varchar({ length: 100 }).notNull(),
	productVariantId: integer("product_variant_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	uniqueIndex("ix_barcodes_barcode").using("btree", table.barcode.asc().nullsLast().op("text_ops")),
	index("ix_barcodes_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.productVariantId],
			foreignColumns: [productVariants.id],
			name: "barcodes_product_variant_id_fkey"
		}).onDelete("cascade"),
]);

export const inventoryTransactions = pgTable("inventory_transactions", {
	id: serial().primaryKey().notNull(),
	transactionType: transactiontype("transaction_type").notNull(),
	productVariantId: integer("product_variant_id").notNull(),
	quantityChange: integer("quantity_change").notNull(),
	referenceType: varchar("reference_type", { length: 50 }),
	referenceId: integer("reference_id"),
	reason: varchar({ length: 500 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdBy: integer("created_by").notNull(),
}, (table) => [
	index("ix_inventory_transactions_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "inventory_transactions_created_by_fkey"
		}),
	foreignKey({
			columns: [table.productVariantId],
			foreignColumns: [productVariants.id],
			name: "inventory_transactions_product_variant_id_fkey"
		}),
]);

export const shopMovements = pgTable("shop_movements", {
	id: serial().primaryKey().notNull(),
	date: date().notNull(),
	productId: integer("product_id"),
	productName: varchar("product_name", { length: 255 }).notNull(),
	shopId: varchar("shop_id", { length: 50 }).notNull(),
	type: movementtype().notNull(),
	quantity: integer().notNull(),
	stockBefore: integer("stock_before").notNull(),
	stockAfter: integer("stock_after").notNull(),
	costPerUnit: numeric("cost_per_unit", { precision: 10, scale:  4 }),
	reference: varchar({ length: 100 }),
	note: varchar({ length: 500 }),
	createdBy: integer("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	reversesId: integer("reverses_id"),
	reversedById: integer("reversed_by_id"),
	saleAmount: numeric("sale_amount", { precision: 10, scale:  2 }),
}, (table) => [
	index("ix_shop_movements_date").using("btree", table.date.asc().nullsLast().op("date_ops")),
	index("ix_shop_movements_product_id").using("btree", table.productId.asc().nullsLast().op("int4_ops")),
	index("ix_shop_movements_shop_id").using("btree", table.shopId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "shop_movements_created_by_fkey"
		}),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [shopProducts.id],
			name: "shop_movements_product_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.reversedById],
			foreignColumns: [table.id],
			name: "shop_movements_reversed_by_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.reversesId],
			foreignColumns: [table.id],
			name: "shop_movements_reverses_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.shopId],
			foreignColumns: [shops.id],
			name: "shop_movements_shop_id_fkey"
		}).onDelete("cascade"),
]);

export const walletTransactions = pgTable("wallet_transactions", {
	id: serial().primaryKey().notNull(),
	walletId: integer("wallet_id").notNull(),
	transactionType: wallettransactiontype("transaction_type").notNull(),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	balanceBefore: numeric("balance_before", { precision: 10, scale:  2 }).notNull(),
	balanceAfter: numeric("balance_after", { precision: 10, scale:  2 }).notNull(),
	referenceType: varchar("reference_type", { length: 50 }),
	referenceId: integer("reference_id"),
	description: varchar({ length: 500 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdBy: integer("created_by").notNull(),
	reason: text(),
	referenceTicket: varchar("reference_ticket", { length: 100 }),
	refundMethod: varchar("refund_method", { length: 20 }),
	actingUserId: integer("acting_user_id"),
	actingCustomerId: integer("acting_customer_id"),
}, (table) => [
	index("ix_wallet_transactions_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	uniqueIndex("ix_wallet_tx_cashier_idempotency").using("btree", table.referenceTicket.asc().nullsLast().op("text_ops")).where(sql`((reference_ticket)::text ~~ 'cashier-idem:%'::text)`),
	uniqueIndex("ix_wallet_tx_vendor_idempotency").using("btree", table.referenceTicket.asc().nullsLast().op("text_ops")).where(sql`((reference_ticket)::text ~~ 'vendor-adjust:%'::text)`),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "wallet_transactions_created_by_fkey"
		}),
	foreignKey({
			columns: [table.walletId],
			foreignColumns: [wallets.id],
			name: "wallet_transactions_wallet_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.actingUserId],
			foreignColumns: [users.id],
			name: "wallet_transactions_acting_user_id_fkey"
		}),
	foreignKey({
			columns: [table.actingCustomerId],
			foreignColumns: [customers.id],
			name: "wallet_transactions_acting_customer_id_fkey"
		}),
]);

export const stockLevels = pgTable("stock_levels", {
	id: serial().primaryKey().notNull(),
	productVariantId: integer("product_variant_id").notNull(),
	quantity: integer().notNull(),
	lowStockThreshold: integer("low_stock_threshold").notNull(),
	location: varchar({ length: 100 }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedBy: integer("updated_by"),
}, (table) => [
	index("ix_stock_levels_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.productVariantId],
			foreignColumns: [productVariants.id],
			name: "stock_levels_product_variant_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [users.id],
			name: "stock_levels_updated_by_fkey"
		}),
	unique("stock_levels_product_variant_id_key").on(table.productVariantId),
]);

export const stockMovements = pgTable("stock_movements", {
	id: serial().primaryKey().notNull(),
	productVariantId: integer("product_variant_id").notNull(),
	quantityBefore: integer("quantity_before").notNull(),
	quantityChange: integer("quantity_change").notNull(),
	quantityAfter: integer("quantity_after").notNull(),
	movementType: transactiontype("movement_type").notNull(),
	referenceDocument: varchar("reference_document", { length: 100 }),
	notes: varchar({ length: 500 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdBy: integer("created_by").notNull(),
}, (table) => [
	index("ix_stock_movements_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "stock_movements_created_by_fkey"
		}),
	foreignKey({
			columns: [table.productVariantId],
			foreignColumns: [productVariants.id],
			name: "stock_movements_product_variant_id_fkey"
		}),
]);

export const users = pgTable("users", {
	id: serial().primaryKey().notNull(),
	username: varchar({ length: 50 }).notNull(),
	email: varchar({ length: 255 }).notNull(),
	fullName: varchar("full_name", { length: 255 }).notNull(),
	hashedPassword: varchar("hashed_password", { length: 255 }).notNull(),
	isActive: boolean("is_active").notNull(),
	isSuperuser: boolean("is_superuser").notNull(),
	role: varchar({ length: 20 }).default('cashier'),
	terminalId: varchar("terminal_id", { length: 50 }),
	externalId: varchar("external_id", { length: 50 }),
	familyCode: varchar("family_code", { length: 20 }),
	photoUrl: varchar("photo_url", { length: 500 }),
	status: varchar({ length: 20 }).default('active').notNull(),
	lastSyncedAt: timestamp("last_synced_at", { withTimezone: true, mode: 'string' }),
	allergies: text(),
	cardUid: varchar("card_uid", { length: 50 }),
	customerType: varchar("customer_type", { length: 20 }),
	shopId: varchar("shop_id", { length: 50 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	departmentId: integer("department_id"),
	shopModule: varchar("shop_module", { length: 20 }),
	sessionToken: varchar("session_token", { length: 64 }),
	staffType: varchar("staff_type", { length: 30 }),
	psDepartment: varchar("ps_department", { length: 100 }),
}, (table) => [
	index("ix_users_card_uid").using("btree", table.cardUid.asc().nullsLast().op("text_ops")),
	uniqueIndex("ix_users_email").using("btree", table.email.asc().nullsLast().op("text_ops")),
	uniqueIndex("ix_users_external_id").using("btree", table.externalId.asc().nullsLast().op("text_ops")),
	index("ix_users_family_code").using("btree", table.familyCode.asc().nullsLast().op("text_ops")),
	index("ix_users_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	index("ix_users_shop_id").using("btree", table.shopId.asc().nullsLast().op("text_ops")),
	uniqueIndex("ix_users_username").using("btree", table.username.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.departmentId],
			foreignColumns: [departments.id],
			name: "users_department_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.shopId],
			foreignColumns: [shops.id],
			name: "users_shop_id_fkey"
		}).onDelete("set null"),
]);

export const approvalRequests = pgTable("approval_requests", {
	id: serial().primaryKey().notNull(),
	requestType: approvalrequesttype("request_type").notNull(),
	requestedBy: integer("requested_by").notNull(),
	requestDate: timestamp("request_date", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	status: approvalstatus().notNull(),
	amount: numeric({ precision: 10, scale:  2 }),
	reason: text(),
	referenceType: varchar("reference_type", { length: 50 }),
	referenceId: integer("reference_id"),
	approvedBy: integer("approved_by"),
	approvalDate: timestamp("approval_date", { withTimezone: true, mode: 'string' }),
	approvalNotes: text("approval_notes"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("ix_approval_requests_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.approvedBy],
			foreignColumns: [users.id],
			name: "approval_requests_approved_by_fkey"
		}),
	foreignKey({
			columns: [table.requestedBy],
			foreignColumns: [users.id],
			name: "approval_requests_requested_by_fkey"
		}),
]);

export const auditLogs = pgTable("audit_logs", {
	id: serial().primaryKey().notNull(),
	entityType: varchar("entity_type", { length: 50 }).notNull(),
	entityId: integer("entity_id"),
	action: auditaction().notNull(),
	userId: integer("user_id").notNull(),
	changesJson: json("changes_json"),
	ipAddress: varchar("ip_address", { length: 50 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	metadata: json(),
	shopId: varchar("shop_id", { length: 50 }),
	entityName: varchar("entity_name", { length: 255 }),
}, (table) => [
	index("ix_audit_logs_created").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("ix_audit_logs_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("ix_audit_logs_entity").using("btree", table.entityType.asc().nullsLast().op("text_ops"), table.entityId.asc().nullsLast().op("int4_ops")),
	index("ix_audit_logs_entity_id").using("btree", table.entityId.asc().nullsLast().op("int4_ops")),
	index("ix_audit_logs_entity_type").using("btree", table.entityType.asc().nullsLast().op("text_ops")),
	index("ix_audit_logs_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	index("ix_audit_logs_shop").using("btree", table.shopId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "audit_logs_user_id_fkey"
		}),
]);

export const budgetTransactions = pgTable("budget_transactions", {
	id: serial().primaryKey().notNull(),
	departmentId: integer("department_id").notNull(),
	transactionDate: timestamp("transaction_date", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	transactionType: budgettransactiontype("transaction_type").notNull(),
	referenceType: varchar("reference_type", { length: 50 }),
	referenceId: integer("reference_id"),
	description: varchar({ length: 500 }),
	balanceBefore: numeric("balance_before", { precision: 12, scale:  2 }).notNull(),
	balanceAfter: numeric("balance_after", { precision: 12, scale:  2 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdBy: integer("created_by").notNull(),
}, (table) => [
	index("ix_budget_transactions_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "budget_transactions_created_by_fkey"
		}),
	foreignKey({
			columns: [table.departmentId],
			foreignColumns: [departments.id],
			name: "budget_transactions_department_id_fkey"
		}).onDelete("cascade"),
]);

export const customerDisplayImages = pgTable("customer_display_images", {
	id: serial().primaryKey().notNull(),
	data: bytea("data").notNull(),
	contentType: varchar("content_type", { length: 50 }).notNull(),
	filename: varchar({ length: 200 }),
	sizeBytes: integer("size_bytes").notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	uploadedBy: integer("uploaded_by"),
}, (table) => [
	index("ix_customer_display_images_sort").using("btree", table.sortOrder.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.uploadedBy],
			foreignColumns: [users.id],
			name: "customer_display_images_uploaded_by_fkey"
		}).onDelete("set null"),
]);

export const identityMappings = pgTable("identity_mappings", {
	id: serial().primaryKey().notNull(),
	entityType: varchar("entity_type", { length: 20 }).notNull(),
	entityId: integer("entity_id").notNull(),
	oldExternalId: varchar("old_external_id", { length: 50 }),
	newExternalId: varchar("new_external_id", { length: 50 }),
	reason: varchar({ length: 200 }),
	changedBy: integer("changed_by"),
	changedAt: timestamp("changed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_identity_mappings_entity").using("btree", table.entityType.asc().nullsLast().op("text_ops"), table.entityId.asc().nullsLast().op("int4_ops")),
	index("ix_identity_mappings_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.changedBy],
			foreignColumns: [users.id],
			name: "identity_mappings_changed_by_fkey"
		}),
]);

export const productOrderHistory = pgTable("product_order_history", {
	id: serial().primaryKey().notNull(),
	shopId: varchar("shop_id", { length: 50 }).notNull(),
	version: integer().notNull(),
	sortMap: json("sort_map").notNull(),
	changedBy: integer("changed_by"),
	changedAt: timestamp("changed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	source: varchar({ length: 20 }),
}, (table) => [
	index("ix_product_order_history_shop").using("btree", table.shopId.asc().nullsLast().op("text_ops"), table.version.desc().nullsFirst().op("int4_ops")),
	index("ix_product_order_history_shop_id").using("btree", table.shopId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.changedBy],
			foreignColumns: [users.id],
			name: "product_order_history_changed_by_fkey"
		}),
	foreignKey({
			columns: [table.shopId],
			foreignColumns: [shops.id],
			name: "product_order_history_shop_id_fkey"
		}).onDelete("cascade"),
]);

export const stockPeriodCloses = pgTable("stock_period_closes", {
	id: serial().primaryKey().notNull(),
	shopId: varchar("shop_id", { length: 50 }).notNull(),
	periodYear: integer("period_year").notNull(),
	periodMonth: integer("period_month").notNull(),
	status: varchar({ length: 10 }).default('draft').notNull(),
	closedBy: integer("closed_by"),
	closedAt: timestamp("closed_at", { withTimezone: true, mode: 'string' }),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_stock_period_closes_shop_id").using("btree", table.shopId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.closedBy],
			foreignColumns: [users.id],
			name: "stock_period_closes_closed_by_fkey"
		}),
	foreignKey({
			columns: [table.shopId],
			foreignColumns: [shops.id],
			name: "stock_period_closes_shop_id_fkey"
		}).onDelete("cascade"),
	unique("uq_stock_period_closes_shop_period").on(table.periodMonth, table.periodYear, table.shopId),
]);

export const syncLogs = pgTable("sync_logs", {
	id: serial().primaryKey().notNull(),
	syncType: varchar("sync_type", { length: 20 }).notNull(),
	targetRoles: jsonb("target_roles").notNull(),
	triggeredBy: integer("triggered_by"),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	finishedAt: timestamp("finished_at", { withTimezone: true, mode: 'string' }),
	status: varchar({ length: 20 }).notNull(),
	recordsTotal: integer("records_total").notNull(),
	recordsSuccess: integer("records_success").notNull(),
	recordsFailed: integer("records_failed").notNull(),
	errorLog: text("error_log"),
}, (table) => [
	index("ix_sync_logs_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	index("ix_sync_logs_started").using("btree", table.startedAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.triggeredBy],
			foreignColumns: [users.id],
			name: "sync_logs_triggered_by_fkey"
		}),
]);

export const systemSettings = pgTable("system_settings", {
	id: serial().primaryKey().notNull(),
	key: varchar({ length: 100 }).notNull(),
	value: text().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedBy: integer("updated_by"),
}, (table) => [
	index("ix_system_settings_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	uniqueIndex("ix_system_settings_key").using("btree", table.key.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [users.id],
			name: "system_settings_updated_by_fkey"
		}),
]);

export const syncAuditLogs = pgTable("sync_audit_logs", {
	id: serial().primaryKey().notNull(),
	syncLogId: integer("sync_log_id").notNull(),
	entityType: varchar("entity_type", { length: 20 }).notNull(),
	entityId: integer("entity_id").notNull(),
	entityName: varchar("entity_name", { length: 255 }),
	externalId: varchar("external_id", { length: 50 }),
	action: varchar({ length: 20 }).notNull(),
	changes: json(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_sync_audit_entity").using("btree", table.entityType.asc().nullsLast().op("text_ops"), table.entityId.asc().nullsLast().op("int4_ops")),
	index("ix_sync_audit_log_id").using("btree", table.syncLogId.asc().nullsLast().op("int4_ops")),
	index("ix_sync_audit_logs_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	index("ix_sync_audit_logs_sync_log_id").using("btree", table.syncLogId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.syncLogId],
			foreignColumns: [syncLogs.id],
			name: "sync_audit_logs_sync_log_id_fkey"
		}).onDelete("cascade"),
]);

export const shops = pgTable("shops", {
	id: varchar({ length: 50 }).primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	shopType: shoptype("shop_type").notNull(),
	description: varchar({ length: 500 }),
	isActive: boolean("is_active").notNull(),
	allowDepartmentCharge: boolean("allow_department_charge").default(false).notNull(),
	module: varchar({ length: 20 }).default('store').notNull(),
	usesDualPricing: boolean("uses_dual_pricing").default(true).notNull(),
	productsOrderVersion: integer("products_order_version").default(1).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	receiptHeader: varchar("receipt_header", { length: 500 }),
	receiptFooter: varchar("receipt_footer", { length: 500 }),
	voidShortcuts: jsonb("void_shortcuts").$type<string[]>().default([]).notNull(),
	shopNumber: integer("shop_number"),
});

export const pricePanels = pgTable("price_panels", {
	id: serial().primaryKey().notNull(),
	shopId: varchar("shop_id", { length: 50 }).notNull(),
	name: varchar({ length: 100 }).notNull(),
	color: varchar({ length: 50 }),
	sortOrder: integer("sort_order").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_price_panels_shop_id").using("btree", table.shopId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.shopId],
			foreignColumns: [shops.id],
			name: "price_panels_shop_id_fkey"
		}).onDelete("cascade"),
]);

export const productBundles = pgTable("product_bundles", {
	id: serial().primaryKey().notNull(),
	shopId: varchar("shop_id", { length: 50 }).notNull(),
	bundleCode: varchar("bundle_code", { length: 50 }).notNull(),
	name: varchar({ length: 255 }).notNull(),
	description: text(),
	externalPrice: numeric("external_price", { precision: 10, scale:  2 }).notNull(),
	internalPrice: numeric("internal_price", { precision: 10, scale:  2 }).notNull(),
	photoUrl: varchar("photo_url", { length: 500 }),
	color: varchar({ length: 50 }),
	sortOrder: integer("sort_order").notNull(),
	isActive: boolean("is_active").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	barcode: varchar({ length: 100 }),
}, (table) => [
	index("ix_product_bundles_barcode").using("btree", table.barcode.asc().nullsLast().op("text_ops")),
	index("ix_product_bundles_bundle_code").using("btree", table.bundleCode.asc().nullsLast().op("text_ops")),
	index("ix_product_bundles_code").using("btree", table.bundleCode.asc().nullsLast().op("text_ops")),
	index("ix_product_bundles_shop").using("btree", table.shopId.asc().nullsLast().op("text_ops")),
	index("ix_product_bundles_shop_id").using("btree", table.shopId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.shopId],
			foreignColumns: [shops.id],
			name: "product_bundles_shop_id_fkey"
		}).onDelete("cascade"),
]);

export const shopCategories = pgTable("shop_categories", {
	id: varchar({ length: 50 }).primaryKey().notNull(),
	shopId: varchar("shop_id", { length: 50 }).notNull(),
	name: varchar({ length: 100 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("uq_shop_categories_shop_name").using("btree", table.shopId.asc().nullsLast().op("text_ops"), table.name.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.shopId],
			foreignColumns: [shops.id],
			name: "shop_categories_shop_id_fkey"
		}).onDelete("cascade"),
]);

export const products = pgTable("products", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	description: text(),
	categoryId: integer("category_id").notNull(),
	brand: varchar({ length: 100 }),
	isActive: boolean("is_active").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("ix_products_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	index("ix_products_name").using("btree", table.name.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [categories.id],
			name: "products_category_id_fkey"
		}),
]);

export const spendingGroups = pgTable("spending_groups", {
	id: serial().primaryKey().notNull(),
	code: varchar({ length: 40 }).notNull(),
	nameEn: varchar("name_en", { length: 100 }).notNull(),
	nameTh: varchar("name_th", { length: 100 }).notNull(),
	dailyLimit: numeric("daily_limit", { precision: 10, scale:  2 }).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	grades: jsonb().$type<string[]>().default([]).notNull(),
}, (table) => [
	index("ix_spending_groups_active").using("btree", table.isActive.asc().nullsLast().op("bool_ops")),
	uniqueIndex("ix_spending_groups_code").using("btree", table.code.asc().nullsLast().op("text_ops")),
]);

export const receipts = pgTable("receipts", {
	id: serial().primaryKey().notNull(),
	receiptNumber: varchar("receipt_number", { length: 50 }).notNull(),
	transactionDate: timestamp("transaction_date", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	transactionMode: transactionmode("transaction_mode").notNull(),
	customerTypeId: integer("customer_type_id"),
	customerId: integer("customer_id"),
	payerUserId: integer("payer_user_id"),
	payerDepartmentId: integer("payer_department_id"),
	requesterUserId: integer("requester_user_id"),
	shopId: varchar("shop_id", { length: 50 }),
	subtotal: numeric({ precision: 10, scale:  2 }).notNull(),
	discount: numeric({ precision: 10, scale:  2 }).notNull(),
	tax: numeric({ precision: 10, scale:  2 }).notNull(),
	total: numeric({ precision: 10, scale:  2 }).notNull(),
	paymentMethod: paymentmethod("payment_method").notNull(),
	status: receiptstatus().notNull(),
	terminalId: varchar("terminal_id", { length: 50 }),
	notes: text(),
	edcTerminalRef: varchar("edc_terminal_ref", { length: 50 }),
	edcApprovalCode: varchar("edc_approval_code", { length: 20 }),
	edcMaskedCard: varchar("edc_masked_card", { length: 30 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdBy: integer("created_by").notNull(),
	voidedAt: timestamp("voided_at", { withTimezone: true, mode: 'string' }),
	voidedBy: integer("voided_by"),
	voidedReason: varchar("voided_reason", { length: 500 }),
	cashReceived: numeric("cash_received", { precision: 10, scale:  2 }),
	spendingGroupId: integer("spending_group_id"),
}, (table) => [
	index("ix_receipts_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	index("ix_receipts_payer_department_id").using("btree", table.payerDepartmentId.asc().nullsLast().op("int4_ops")),
	index("ix_receipts_payer_dept").using("btree", table.payerDepartmentId.asc().nullsLast().op("int4_ops")),
	index("ix_receipts_payer_shop_date").using("btree", table.payerUserId.asc().nullsLast().op("int4_ops"), table.customerId.asc().nullsLast().op("int4_ops"), table.payerDepartmentId.asc().nullsLast().op("int4_ops"), table.spendingGroupId.asc().nullsLast().op("int4_ops"), table.transactionDate.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'ACTIVE'::receiptstatus)`),
	index("ix_receipts_payer_user").using("btree", table.payerUserId.asc().nullsLast().op("int4_ops")),
	index("ix_receipts_payer_user_id").using("btree", table.payerUserId.asc().nullsLast().op("int4_ops")),
	uniqueIndex("ix_receipts_receipt_number").using("btree", table.receiptNumber.asc().nullsLast().op("text_ops")),
	index("ix_receipts_requester_user_id").using("btree", table.requesterUserId.asc().nullsLast().op("int4_ops")),
	index("ix_receipts_shop").using("btree", table.shopId.asc().nullsLast().op("text_ops")),
	index("ix_receipts_shop_id").using("btree", table.shopId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "receipts_created_by_fkey"
		}),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "receipts_customer_id_fkey"
		}),
	foreignKey({
			columns: [table.customerTypeId],
			foreignColumns: [customerTypes.id],
			name: "receipts_customer_type_id_fkey"
		}),
	foreignKey({
			columns: [table.payerDepartmentId],
			foreignColumns: [departments.id],
			name: "receipts_payer_department_id_fkey"
		}),
	foreignKey({
			columns: [table.payerUserId],
			foreignColumns: [users.id],
			name: "receipts_payer_user_id_fkey"
		}),
	foreignKey({
			columns: [table.requesterUserId],
			foreignColumns: [users.id],
			name: "receipts_requester_user_id_fkey"
		}),
	foreignKey({
			columns: [table.shopId],
			foreignColumns: [shops.id],
			name: "receipts_shop_id_fkey"
		}),
	foreignKey({
			columns: [table.spendingGroupId],
			foreignColumns: [spendingGroups.id],
			name: "receipts_spending_group_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.voidedBy],
			foreignColumns: [users.id],
			name: "receipts_voided_by_fkey"
		}),
]);

export const roles = pgTable("roles", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 50 }).notNull(),
	description: varchar({ length: 255 }),
	isActive: boolean("is_active").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("ix_roles_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	unique("roles_name_key").on(table.name),
]);

export const familyProfiles = pgTable("family_profiles", {
	familyCode: varchar("family_code", { length: 20 }).primaryKey().notNull(),
	notificationEmails: jsonb("notification_emails").default([]).notNull(),
	loginIds: jsonb("login_ids").default([]).notNull(),
	lastSyncedAt: timestamp("last_synced_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	// False once family_sweep_service's staleness sweep decides ISB has
	// stopped reporting this family_code at all (see that file for why a
	// per-batch-call check isn't safe). Reactivated automatically the next
	// time upsertFamilyProfile() sees this family_code again.
	isActive: boolean("is_active").default(true).notNull(),
});

export const categories = pgTable("categories", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	description: text(),
	parentId: integer("parent_id"),
	isActive: boolean("is_active").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("ix_categories_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.parentId],
			foreignColumns: [table.id],
			name: "categories_parent_id_fkey"
		}),
	unique("categories_name_key").on(table.name),
]);

export const returnRequests = pgTable("return_requests", {
	id: serial().primaryKey().notNull(),
	receiptId: varchar("receipt_id", { length: 50 }).notNull(),
	productCode: varchar("product_code", { length: 50 }).notNull(),
	productName: varchar("product_name", { length: 255 }).notNull(),
	quantity: integer().notNull(),
	returnQuantity: integer("return_quantity").notNull(),
	price: numeric({ precision: 10, scale:  2 }).notNull(),
	reason: varchar({ length: 500 }).notNull(),
	status: returnstatus().notNull(),
	priceType: varchar("price_type", { length: 20 }),
	voidStatus: varchar("void_status", { length: 20 }),
	returnStatus: varchar("return_status", { length: 20 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdBy: integer("created_by"),
	refundMethod: varchar("refund_method", { length: 20 }),
	exchangeProductCodes: varchar("exchange_product_codes", { length: 500 }),
	refundAmount: numeric("refund_amount", { precision: 10, scale:  2 }),
	exchangeAmount: numeric("exchange_amount", { precision: 10, scale:  2 }),
	processedAt: timestamp("processed_at", { withTimezone: true, mode: 'string' }),
	bundleId: integer("bundle_id"),
}, (table) => [
	index("ix_return_requests_bundle_id").using("btree", table.bundleId.asc().nullsLast().op("int4_ops")),
	index("ix_return_requests_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
	index("ix_return_requests_receipt_id").using("btree", table.receiptId.asc().nullsLast().op("text_ops")),
]);

export const userRoles = pgTable("user_roles", {
	userId: integer("user_id").notNull(),
	roleId: integer("role_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.roleId],
			foreignColumns: [roles.id],
			name: "user_roles_role_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_roles_user_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.roleId, table.userId], name: "user_roles_pkey"}),
]);

export const rolePermissions = pgTable("role_permissions", {
	roleId: integer("role_id").notNull(),
	permissionId: integer("permission_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.permissionId],
			foreignColumns: [permissions.id],
			name: "role_permissions_permission_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.roleId],
			foreignColumns: [roles.id],
			name: "role_permissions_role_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.permissionId, table.roleId], name: "role_permissions_pkey"}),
]);

export const shopSpendingGroups = pgTable("shop_spending_groups", {
	shopId: varchar("shop_id", { length: 50 }).notNull(),
	spendingGroupId: integer("spending_group_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_shop_spending_groups_group").using("btree", table.spendingGroupId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.shopId],
			foreignColumns: [shops.id],
			name: "shop_spending_groups_shop_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.spendingGroupId],
			foreignColumns: [spendingGroups.id],
			name: "shop_spending_groups_spending_group_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.shopId, table.spendingGroupId], name: "shop_spending_groups_pkey"}),
]);
