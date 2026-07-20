import { relations } from "drizzle-orm/relations";
import { users, creditNotes, receipts, customers, wallets, departments, userLoginEmails, customerTypes, paymentIntents, shopProducts, receiptItems, emailAlertsLog, parentChildLinks, shops, unitsOfMeasure, productBundles, bundleItems, fifoLots, menuOptionGroups, pricePanelItems, pricePanels, productBarcodes, shopMovements, stockPeriodCloseItems, stockPeriodCloses, menuOptions, products, productVariants, barcodes, inventoryTransactions, walletTransactions, stockLevels, stockMovements, approvalRequests, auditLogs, budgetTransactions, customerDisplayImages, identityMappings, productOrderHistory, syncLogs, systemSettings, syncAuditLogs, shopCategories, categories, spendingGroups, roles, userRoles, permissions, rolePermissions, shopSpendingGroups } from "./schema";

export const creditNotesRelations = relations(creditNotes, ({one}) => ({
	user_approvedBy: one(users, {
		fields: [creditNotes.approvedBy],
		references: [users.id],
		relationName: "creditNotes_approvedBy_users_id"
	}),
	user_createdBy: one(users, {
		fields: [creditNotes.createdBy],
		references: [users.id],
		relationName: "creditNotes_createdBy_users_id"
	}),
	receipt: one(receipts, {
		fields: [creditNotes.originalReceiptId],
		references: [receipts.id]
	}),
}));

export const usersRelations = relations(users, ({one, many}) => ({
	creditNotes_approvedBy: many(creditNotes, {
		relationName: "creditNotes_approvedBy_users_id"
	}),
	creditNotes_createdBy: many(creditNotes, {
		relationName: "creditNotes_createdBy_users_id"
	}),
	wallets: many(wallets),
	userLoginEmails: many(userLoginEmails),
	paymentIntents_confirmedBy: many(paymentIntents, {
		relationName: "paymentIntents_confirmedBy_users_id"
	}),
	paymentIntents_createdBy: many(paymentIntents, {
		relationName: "paymentIntents_createdBy_users_id"
	}),
	paymentIntents_actingUserId: many(paymentIntents, {
		relationName: "paymentIntents_actingUserId_users_id"
	}),
	emailAlertsLogs: many(emailAlertsLog),
	parentChildLinks: many(parentChildLinks),
	inventoryTransactions: many(inventoryTransactions),
	shopMovements: many(shopMovements),
	walletTransactions_createdBy: many(walletTransactions, {
		relationName: "walletTransactions_createdBy_users_id"
	}),
	walletTransactions_actingUserId: many(walletTransactions, {
		relationName: "walletTransactions_actingUserId_users_id"
	}),
	stockLevels: many(stockLevels),
	stockMovements: many(stockMovements),
	department: one(departments, {
		fields: [users.departmentId],
		references: [departments.id]
	}),
	shop: one(shops, {
		fields: [users.shopId],
		references: [shops.id]
	}),
	approvalRequests_approvedBy: many(approvalRequests, {
		relationName: "approvalRequests_approvedBy_users_id"
	}),
	approvalRequests_requestedBy: many(approvalRequests, {
		relationName: "approvalRequests_requestedBy_users_id"
	}),
	auditLogs: many(auditLogs),
	budgetTransactions: many(budgetTransactions),
	customerDisplayImages: many(customerDisplayImages),
	identityMappings: many(identityMappings),
	productOrderHistories: many(productOrderHistory),
	stockPeriodCloses: many(stockPeriodCloses),
	syncLogs: many(syncLogs),
	systemSettings: many(systemSettings),
	receipts_createdBy: many(receipts, {
		relationName: "receipts_createdBy_users_id"
	}),
	receipts_payerUserId: many(receipts, {
		relationName: "receipts_payerUserId_users_id"
	}),
	receipts_requesterUserId: many(receipts, {
		relationName: "receipts_requesterUserId_users_id"
	}),
	receipts_voidedBy: many(receipts, {
		relationName: "receipts_voidedBy_users_id"
	}),
	userRoles: many(userRoles),
}));

export const receiptsRelations = relations(receipts, ({one, many}) => ({
	creditNotes: many(creditNotes),
	receiptItems: many(receiptItems),
	user_createdBy: one(users, {
		fields: [receipts.createdBy],
		references: [users.id],
		relationName: "receipts_createdBy_users_id"
	}),
	customer: one(customers, {
		fields: [receipts.customerId],
		references: [customers.id]
	}),
	customerType: one(customerTypes, {
		fields: [receipts.customerTypeId],
		references: [customerTypes.id]
	}),
	department: one(departments, {
		fields: [receipts.payerDepartmentId],
		references: [departments.id]
	}),
	user_payerUserId: one(users, {
		fields: [receipts.payerUserId],
		references: [users.id],
		relationName: "receipts_payerUserId_users_id"
	}),
	user_requesterUserId: one(users, {
		fields: [receipts.requesterUserId],
		references: [users.id],
		relationName: "receipts_requesterUserId_users_id"
	}),
	shop: one(shops, {
		fields: [receipts.shopId],
		references: [shops.id]
	}),
	spendingGroup: one(spendingGroups, {
		fields: [receipts.spendingGroupId],
		references: [spendingGroups.id]
	}),
	user_voidedBy: one(users, {
		fields: [receipts.voidedBy],
		references: [users.id],
		relationName: "receipts_voidedBy_users_id"
	}),
}));

export const walletsRelations = relations(wallets, ({one, many}) => ({
	customer: one(customers, {
		fields: [wallets.customerId],
		references: [customers.id]
	}),
	department: one(departments, {
		fields: [wallets.departmentId],
		references: [departments.id]
	}),
	user: one(users, {
		fields: [wallets.userId],
		references: [users.id]
	}),
	paymentIntents: many(paymentIntents),
	walletTransactions: many(walletTransactions),
}));

export const customersRelations = relations(customers, ({one, many}) => ({
	wallets: many(wallets),
	customerType: one(customerTypes, {
		fields: [customers.customerTypeId],
		references: [customerTypes.id]
	}),
	department: one(departments, {
		fields: [customers.departmentId],
		references: [departments.id]
	}),
	paymentIntents: many(paymentIntents),
	emailAlertsLogs: many(emailAlertsLog),
	parentChildLinks: many(parentChildLinks),
	walletTransactions: many(walletTransactions),
	receipts: many(receipts),
}));

export const departmentsRelations = relations(departments, ({many}) => ({
	wallets: many(wallets),
	customers: many(customers),
	users: many(users),
	budgetTransactions: many(budgetTransactions),
	receipts: many(receipts),
}));

export const userLoginEmailsRelations = relations(userLoginEmails, ({one}) => ({
	user: one(users, {
		fields: [userLoginEmails.userId],
		references: [users.id]
	}),
}));

export const customerTypesRelations = relations(customerTypes, ({many}) => ({
	customers: many(customers),
	receipts: many(receipts),
}));

export const paymentIntentsRelations = relations(paymentIntents, ({one}) => ({
	user_confirmedBy: one(users, {
		fields: [paymentIntents.confirmedBy],
		references: [users.id],
		relationName: "paymentIntents_confirmedBy_users_id"
	}),
	user_createdBy: one(users, {
		fields: [paymentIntents.createdBy],
		references: [users.id],
		relationName: "paymentIntents_createdBy_users_id"
	}),
	wallet: one(wallets, {
		fields: [paymentIntents.walletId],
		references: [wallets.id]
	}),
	user_actingUserId: one(users, {
		fields: [paymentIntents.actingUserId],
		references: [users.id],
		relationName: "paymentIntents_actingUserId_users_id"
	}),
	customer: one(customers, {
		fields: [paymentIntents.actingCustomerId],
		references: [customers.id]
	}),
}));

export const receiptItemsRelations = relations(receiptItems, ({one}) => ({
	shopProduct: one(shopProducts, {
		fields: [receiptItems.productVariantId],
		references: [shopProducts.id]
	}),
	receipt: one(receipts, {
		fields: [receiptItems.receiptId],
		references: [receipts.id]
	}),
}));

export const shopProductsRelations = relations(shopProducts, ({one, many}) => ({
	receiptItems: many(receiptItems),
	shop: one(shops, {
		fields: [shopProducts.shopId],
		references: [shops.id]
	}),
	unitsOfMeasure: one(unitsOfMeasure, {
		fields: [shopProducts.uomId],
		references: [unitsOfMeasure.id]
	}),
	bundleItems: many(bundleItems),
	fifoLots: many(fifoLots),
	menuOptionGroups: many(menuOptionGroups),
	pricePanelItems: many(pricePanelItems),
	productBarcodes: many(productBarcodes),
	stockPeriodCloseItems: many(stockPeriodCloseItems),
	shopMovements: many(shopMovements),
}));

export const emailAlertsLogRelations = relations(emailAlertsLog, ({one}) => ({
	customer: one(customers, {
		fields: [emailAlertsLog.childCustomerId],
		references: [customers.id]
	}),
	user: one(users, {
		fields: [emailAlertsLog.parentUserId],
		references: [users.id]
	}),
}));

export const parentChildLinksRelations = relations(parentChildLinks, ({one}) => ({
	customer: one(customers, {
		fields: [parentChildLinks.childCustomerId],
		references: [customers.id]
	}),
	user: one(users, {
		fields: [parentChildLinks.parentUserId],
		references: [users.id]
	}),
}));

export const shopsRelations = relations(shops, ({many}) => ({
	shopProducts: many(shopProducts),
	fifoLots: many(fifoLots),
	shopMovements: many(shopMovements),
	users: many(users),
	productOrderHistories: many(productOrderHistory),
	stockPeriodCloses: many(stockPeriodCloses),
	pricePanels: many(pricePanels),
	productBundles: many(productBundles),
	shopCategories: many(shopCategories),
	receipts: many(receipts),
	shopSpendingGroups: many(shopSpendingGroups),
}));

export const unitsOfMeasureRelations = relations(unitsOfMeasure, ({many}) => ({
	shopProducts: many(shopProducts),
}));

export const bundleItemsRelations = relations(bundleItems, ({one}) => ({
	productBundle: one(productBundles, {
		fields: [bundleItems.bundleId],
		references: [productBundles.id]
	}),
	shopProduct: one(shopProducts, {
		fields: [bundleItems.productId],
		references: [shopProducts.id]
	}),
}));

export const productBundlesRelations = relations(productBundles, ({one, many}) => ({
	bundleItems: many(bundleItems),
	pricePanelItems: many(pricePanelItems),
	shop: one(shops, {
		fields: [productBundles.shopId],
		references: [shops.id]
	}),
}));

export const fifoLotsRelations = relations(fifoLots, ({one}) => ({
	shopProduct: one(shopProducts, {
		fields: [fifoLots.productId],
		references: [shopProducts.id]
	}),
	shop: one(shops, {
		fields: [fifoLots.shopId],
		references: [shops.id]
	}),
}));

export const menuOptionGroupsRelations = relations(menuOptionGroups, ({one, many}) => ({
	shopProduct: one(shopProducts, {
		fields: [menuOptionGroups.productId],
		references: [shopProducts.id]
	}),
	menuOptions: many(menuOptions),
}));

export const pricePanelItemsRelations = relations(pricePanelItems, ({one}) => ({
	productBundle: one(productBundles, {
		fields: [pricePanelItems.bundleId],
		references: [productBundles.id]
	}),
	pricePanel: one(pricePanels, {
		fields: [pricePanelItems.panelId],
		references: [pricePanels.id]
	}),
	shopProduct: one(shopProducts, {
		fields: [pricePanelItems.productId],
		references: [shopProducts.id]
	}),
}));

export const pricePanelsRelations = relations(pricePanels, ({one, many}) => ({
	pricePanelItems: many(pricePanelItems),
	shop: one(shops, {
		fields: [pricePanels.shopId],
		references: [shops.id]
	}),
}));

export const productBarcodesRelations = relations(productBarcodes, ({one}) => ({
	shopProduct: one(shopProducts, {
		fields: [productBarcodes.productId],
		references: [shopProducts.id]
	}),
}));

export const stockPeriodCloseItemsRelations = relations(stockPeriodCloseItems, ({one}) => ({
	shopMovement: one(shopMovements, {
		fields: [stockPeriodCloseItems.adjustmentMovementId],
		references: [shopMovements.id]
	}),
	stockPeriodClose: one(stockPeriodCloses, {
		fields: [stockPeriodCloseItems.closeId],
		references: [stockPeriodCloses.id]
	}),
	shopProduct: one(shopProducts, {
		fields: [stockPeriodCloseItems.productId],
		references: [shopProducts.id]
	}),
}));

export const shopMovementsRelations = relations(shopMovements, ({one, many}) => ({
	stockPeriodCloseItems: many(stockPeriodCloseItems),
	user: one(users, {
		fields: [shopMovements.createdBy],
		references: [users.id]
	}),
	shopProduct: one(shopProducts, {
		fields: [shopMovements.productId],
		references: [shopProducts.id]
	}),
	shopMovement_reversedById: one(shopMovements, {
		fields: [shopMovements.reversedById],
		references: [shopMovements.id],
		relationName: "shopMovements_reversedById_shopMovements_id"
	}),
	shopMovements_reversedById: many(shopMovements, {
		relationName: "shopMovements_reversedById_shopMovements_id"
	}),
	shopMovement_reversesId: one(shopMovements, {
		fields: [shopMovements.reversesId],
		references: [shopMovements.id],
		relationName: "shopMovements_reversesId_shopMovements_id"
	}),
	shopMovements_reversesId: many(shopMovements, {
		relationName: "shopMovements_reversesId_shopMovements_id"
	}),
	shop: one(shops, {
		fields: [shopMovements.shopId],
		references: [shops.id]
	}),
}));

export const stockPeriodClosesRelations = relations(stockPeriodCloses, ({one, many}) => ({
	stockPeriodCloseItems: many(stockPeriodCloseItems),
	user: one(users, {
		fields: [stockPeriodCloses.closedBy],
		references: [users.id]
	}),
	shop: one(shops, {
		fields: [stockPeriodCloses.shopId],
		references: [shops.id]
	}),
}));

export const menuOptionsRelations = relations(menuOptions, ({one}) => ({
	menuOptionGroup: one(menuOptionGroups, {
		fields: [menuOptions.optionGroupId],
		references: [menuOptionGroups.id]
	}),
}));

export const productVariantsRelations = relations(productVariants, ({one, many}) => ({
	product: one(products, {
		fields: [productVariants.productId],
		references: [products.id]
	}),
	barcodes: many(barcodes),
	inventoryTransactions: many(inventoryTransactions),
	stockLevels: many(stockLevels),
	stockMovements: many(stockMovements),
}));

export const productsRelations = relations(products, ({one, many}) => ({
	productVariants: many(productVariants),
	category: one(categories, {
		fields: [products.categoryId],
		references: [categories.id]
	}),
}));

export const barcodesRelations = relations(barcodes, ({one}) => ({
	productVariant: one(productVariants, {
		fields: [barcodes.productVariantId],
		references: [productVariants.id]
	}),
}));

export const inventoryTransactionsRelations = relations(inventoryTransactions, ({one}) => ({
	user: one(users, {
		fields: [inventoryTransactions.createdBy],
		references: [users.id]
	}),
	productVariant: one(productVariants, {
		fields: [inventoryTransactions.productVariantId],
		references: [productVariants.id]
	}),
}));

export const walletTransactionsRelations = relations(walletTransactions, ({one}) => ({
	user_createdBy: one(users, {
		fields: [walletTransactions.createdBy],
		references: [users.id],
		relationName: "walletTransactions_createdBy_users_id"
	}),
	wallet: one(wallets, {
		fields: [walletTransactions.walletId],
		references: [wallets.id]
	}),
	user_actingUserId: one(users, {
		fields: [walletTransactions.actingUserId],
		references: [users.id],
		relationName: "walletTransactions_actingUserId_users_id"
	}),
	customer: one(customers, {
		fields: [walletTransactions.actingCustomerId],
		references: [customers.id]
	}),
}));

export const stockLevelsRelations = relations(stockLevels, ({one}) => ({
	productVariant: one(productVariants, {
		fields: [stockLevels.productVariantId],
		references: [productVariants.id]
	}),
	user: one(users, {
		fields: [stockLevels.updatedBy],
		references: [users.id]
	}),
}));

export const stockMovementsRelations = relations(stockMovements, ({one}) => ({
	user: one(users, {
		fields: [stockMovements.createdBy],
		references: [users.id]
	}),
	productVariant: one(productVariants, {
		fields: [stockMovements.productVariantId],
		references: [productVariants.id]
	}),
}));

export const approvalRequestsRelations = relations(approvalRequests, ({one}) => ({
	user_approvedBy: one(users, {
		fields: [approvalRequests.approvedBy],
		references: [users.id],
		relationName: "approvalRequests_approvedBy_users_id"
	}),
	user_requestedBy: one(users, {
		fields: [approvalRequests.requestedBy],
		references: [users.id],
		relationName: "approvalRequests_requestedBy_users_id"
	}),
}));

export const auditLogsRelations = relations(auditLogs, ({one}) => ({
	user: one(users, {
		fields: [auditLogs.userId],
		references: [users.id]
	}),
}));

export const budgetTransactionsRelations = relations(budgetTransactions, ({one}) => ({
	user: one(users, {
		fields: [budgetTransactions.createdBy],
		references: [users.id]
	}),
	department: one(departments, {
		fields: [budgetTransactions.departmentId],
		references: [departments.id]
	}),
}));

export const customerDisplayImagesRelations = relations(customerDisplayImages, ({one}) => ({
	user: one(users, {
		fields: [customerDisplayImages.uploadedBy],
		references: [users.id]
	}),
}));

export const identityMappingsRelations = relations(identityMappings, ({one}) => ({
	user: one(users, {
		fields: [identityMappings.changedBy],
		references: [users.id]
	}),
}));

export const productOrderHistoryRelations = relations(productOrderHistory, ({one}) => ({
	user: one(users, {
		fields: [productOrderHistory.changedBy],
		references: [users.id]
	}),
	shop: one(shops, {
		fields: [productOrderHistory.shopId],
		references: [shops.id]
	}),
}));

export const syncLogsRelations = relations(syncLogs, ({one, many}) => ({
	user: one(users, {
		fields: [syncLogs.triggeredBy],
		references: [users.id]
	}),
	syncAuditLogs: many(syncAuditLogs),
}));

export const systemSettingsRelations = relations(systemSettings, ({one}) => ({
	user: one(users, {
		fields: [systemSettings.updatedBy],
		references: [users.id]
	}),
}));

export const syncAuditLogsRelations = relations(syncAuditLogs, ({one}) => ({
	syncLog: one(syncLogs, {
		fields: [syncAuditLogs.syncLogId],
		references: [syncLogs.id]
	}),
}));

export const shopCategoriesRelations = relations(shopCategories, ({one}) => ({
	shop: one(shops, {
		fields: [shopCategories.shopId],
		references: [shops.id]
	}),
}));

export const categoriesRelations = relations(categories, ({one, many}) => ({
	products: many(products),
	category: one(categories, {
		fields: [categories.parentId],
		references: [categories.id],
		relationName: "categories_parentId_categories_id"
	}),
	categories: many(categories, {
		relationName: "categories_parentId_categories_id"
	}),
}));

export const spendingGroupsRelations = relations(spendingGroups, ({many}) => ({
	receipts: many(receipts),
	shopSpendingGroups: many(shopSpendingGroups),
}));

export const userRolesRelations = relations(userRoles, ({one}) => ({
	role: one(roles, {
		fields: [userRoles.roleId],
		references: [roles.id]
	}),
	user: one(users, {
		fields: [userRoles.userId],
		references: [users.id]
	}),
}));

export const rolesRelations = relations(roles, ({many}) => ({
	userRoles: many(userRoles),
	rolePermissions: many(rolePermissions),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({one}) => ({
	permission: one(permissions, {
		fields: [rolePermissions.permissionId],
		references: [permissions.id]
	}),
	role: one(roles, {
		fields: [rolePermissions.roleId],
		references: [roles.id]
	}),
}));

export const permissionsRelations = relations(permissions, ({many}) => ({
	rolePermissions: many(rolePermissions),
}));

export const shopSpendingGroupsRelations = relations(shopSpendingGroups, ({one}) => ({
	shop: one(shops, {
		fields: [shopSpendingGroups.shopId],
		references: [shops.id]
	}),
	spendingGroup: one(spendingGroups, {
		fields: [shopSpendingGroups.spendingGroupId],
		references: [spendingGroups.id]
	}),
}));