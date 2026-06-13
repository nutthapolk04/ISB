import { relations } from "drizzle-orm/relations";
import { categories, spendingGroups, shops, departments, users, products, shopCategories, customerTypes, customers, productVariants, receipts, wallets, budgetTransactions, approvalRequests, auditLogs, shopProducts, menuOptionGroups, shopMovements, productOrderHistory, fifoLots, identityMappings, syncLogs, systemSettings, barcodes, stockLevels, parentChildLinks, inventoryTransactions, stockMovements, walletTransactions, receiptItems, creditNotes, menuOptions, productBundles, syncAuditLogs, paymentIntents, bundleItems, pricePanels, unitsOfMeasure, pricePanelItems, productBarcodes, customerDisplayImages, emailAlertsLog, permissions, rolePermissions, roles, userRoles } from "./schema";

export const categoriesRelations = relations(categories, ({one, many}) => ({
	category: one(categories, {
		fields: [categories.parentId],
		references: [categories.id],
		relationName: "categories_parentId_categories_id"
	}),
	categories: many(categories, {
		relationName: "categories_parentId_categories_id"
	}),
	products: many(products),
}));

export const shopsRelations = relations(shops, ({one, many}) => ({
	spendingGroup: one(spendingGroups, {
		fields: [shops.spendingGroupId],
		references: [spendingGroups.id]
	}),
	users: many(users),
	shopCategories: many(shopCategories),
	receipts: many(receipts),
	shopMovements: many(shopMovements),
	productOrderHistories: many(productOrderHistory),
	fifoLots: many(fifoLots),
	productBundles: many(productBundles),
	pricePanels: many(pricePanels),
	shopProducts: many(shopProducts),
}));

export const spendingGroupsRelations = relations(spendingGroups, ({many}) => ({
	shops: many(shops),
	receipts: many(receipts),
}));

export const usersRelations = relations(users, ({one, many}) => ({
	department: one(departments, {
		fields: [users.departmentId],
		references: [departments.id]
	}),
	shop: one(shops, {
		fields: [users.shopId],
		references: [shops.id]
	}),
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
	wallets: many(wallets),
	budgetTransactions: many(budgetTransactions),
	approvalRequests_approvedBy: many(approvalRequests, {
		relationName: "approvalRequests_approvedBy_users_id"
	}),
	approvalRequests_requestedBy: many(approvalRequests, {
		relationName: "approvalRequests_requestedBy_users_id"
	}),
	auditLogs: many(auditLogs),
	shopMovements: many(shopMovements),
	productOrderHistories: many(productOrderHistory),
	identityMappings: many(identityMappings),
	syncLogs: many(syncLogs),
	systemSettings: many(systemSettings),
	stockLevels: many(stockLevels),
	parentChildLinks: many(parentChildLinks),
	inventoryTransactions: many(inventoryTransactions),
	stockMovements: many(stockMovements),
	walletTransactions: many(walletTransactions),
	creditNotes_approvedBy: many(creditNotes, {
		relationName: "creditNotes_approvedBy_users_id"
	}),
	creditNotes_createdBy: many(creditNotes, {
		relationName: "creditNotes_createdBy_users_id"
	}),
	paymentIntents_confirmedBy: many(paymentIntents, {
		relationName: "paymentIntents_confirmedBy_users_id"
	}),
	paymentIntents_createdBy: many(paymentIntents, {
		relationName: "paymentIntents_createdBy_users_id"
	}),
	customerDisplayImages: many(customerDisplayImages),
	emailAlertsLogs: many(emailAlertsLog),
	userRoles: many(userRoles),
}));

export const departmentsRelations = relations(departments, ({many}) => ({
	users: many(users),
	customers: many(customers),
	receipts: many(receipts),
	wallets: many(wallets),
	budgetTransactions: many(budgetTransactions),
}));

export const productsRelations = relations(products, ({one, many}) => ({
	category: one(categories, {
		fields: [products.categoryId],
		references: [categories.id]
	}),
	productVariants: many(productVariants),
}));

export const shopCategoriesRelations = relations(shopCategories, ({one}) => ({
	shop: one(shops, {
		fields: [shopCategories.shopId],
		references: [shops.id]
	}),
}));

export const customersRelations = relations(customers, ({one, many}) => ({
	customerType: one(customerTypes, {
		fields: [customers.customerTypeId],
		references: [customerTypes.id]
	}),
	department: one(departments, {
		fields: [customers.departmentId],
		references: [departments.id]
	}),
	receipts: many(receipts),
	wallets: many(wallets),
	parentChildLinks: many(parentChildLinks),
	emailAlertsLogs: many(emailAlertsLog),
}));

export const customerTypesRelations = relations(customerTypes, ({many}) => ({
	customers: many(customers),
	receipts: many(receipts),
}));

export const productVariantsRelations = relations(productVariants, ({one, many}) => ({
	product: one(products, {
		fields: [productVariants.productId],
		references: [products.id]
	}),
	barcodes: many(barcodes),
	stockLevels: many(stockLevels),
	inventoryTransactions: many(inventoryTransactions),
	stockMovements: many(stockMovements),
}));

export const receiptsRelations = relations(receipts, ({one, many}) => ({
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
	receiptItems: many(receiptItems),
	creditNotes: many(creditNotes),
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
	walletTransactions: many(walletTransactions),
	paymentIntents: many(paymentIntents),
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

export const menuOptionGroupsRelations = relations(menuOptionGroups, ({one, many}) => ({
	shopProduct: one(shopProducts, {
		fields: [menuOptionGroups.productId],
		references: [shopProducts.id]
	}),
	menuOptions: many(menuOptions),
}));

export const shopProductsRelations = relations(shopProducts, ({one, many}) => ({
	menuOptionGroups: many(menuOptionGroups),
	shopMovements: many(shopMovements),
	fifoLots: many(fifoLots),
	receiptItems: many(receiptItems),
	bundleItems: many(bundleItems),
	shop: one(shops, {
		fields: [shopProducts.shopId],
		references: [shops.id]
	}),
	unitsOfMeasure: one(unitsOfMeasure, {
		fields: [shopProducts.uomId],
		references: [unitsOfMeasure.id]
	}),
	pricePanelItems: many(pricePanelItems),
	productBarcodes: many(productBarcodes),
}));

export const shopMovementsRelations = relations(shopMovements, ({one, many}) => ({
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

export const identityMappingsRelations = relations(identityMappings, ({one}) => ({
	user: one(users, {
		fields: [identityMappings.changedBy],
		references: [users.id]
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

export const barcodesRelations = relations(barcodes, ({one}) => ({
	productVariant: one(productVariants, {
		fields: [barcodes.productVariantId],
		references: [productVariants.id]
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

export const walletTransactionsRelations = relations(walletTransactions, ({one}) => ({
	user: one(users, {
		fields: [walletTransactions.createdBy],
		references: [users.id]
	}),
	wallet: one(wallets, {
		fields: [walletTransactions.walletId],
		references: [wallets.id]
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

export const menuOptionsRelations = relations(menuOptions, ({one}) => ({
	menuOptionGroup: one(menuOptionGroups, {
		fields: [menuOptions.optionGroupId],
		references: [menuOptionGroups.id]
	}),
}));

export const productBundlesRelations = relations(productBundles, ({one, many}) => ({
	shop: one(shops, {
		fields: [productBundles.shopId],
		references: [shops.id]
	}),
	bundleItems: many(bundleItems),
	pricePanelItems: many(pricePanelItems),
}));

export const syncAuditLogsRelations = relations(syncAuditLogs, ({one}) => ({
	syncLog: one(syncLogs, {
		fields: [syncAuditLogs.syncLogId],
		references: [syncLogs.id]
	}),
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

export const pricePanelsRelations = relations(pricePanels, ({one, many}) => ({
	shop: one(shops, {
		fields: [pricePanels.shopId],
		references: [shops.id]
	}),
	pricePanelItems: many(pricePanelItems),
}));

export const unitsOfMeasureRelations = relations(unitsOfMeasure, ({many}) => ({
	shopProducts: many(shopProducts),
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

export const productBarcodesRelations = relations(productBarcodes, ({one}) => ({
	shopProduct: one(shopProducts, {
		fields: [productBarcodes.productId],
		references: [shopProducts.id]
	}),
}));

export const customerDisplayImagesRelations = relations(customerDisplayImages, ({one}) => ({
	user: one(users, {
		fields: [customerDisplayImages.uploadedBy],
		references: [users.id]
	}),
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

export const rolesRelations = relations(roles, ({many}) => ({
	rolePermissions: many(rolePermissions),
	userRoles: many(userRoles),
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