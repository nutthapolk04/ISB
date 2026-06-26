import { Elysia } from "elysia";
import { requireAuth } from "@/middleware/AuthUtils";
import { authRateLimit } from "@/middleware/RateLimitMiddleware";
import { mapValidationError, syncValidationFailed } from "@/lib/isb_sync_response";
import { HealthController } from "@/controllers/HealthController";
import { AuthController } from "@/controllers/AuthController";
import { IsbSyncController } from "@/controllers/IsbSyncController";
import { BayCallbackController } from "@/controllers/BayCallbackController";
import { PublicSettingsController } from "@/controllers/PublicSettingsController";
import { DepartmentController } from "@/controllers/DepartmentController";
import { UserController } from "@/controllers/UserController";
import { UsersAdminController } from "@/controllers/UsersAdminController";
import { AdminAuditController } from "@/controllers/AdminAuditController";
import { AdminSettingsController } from "@/controllers/AdminSettingsController";
import { CustomerController } from "@/controllers/CustomerController";
import { ProductController } from "@/controllers/ProductController";
import { ReportController } from "@/controllers/ReportController";
import { ShopController } from "@/controllers/ShopController";
import { ShopCatalogController } from "@/controllers/ShopCatalogController";
import { WalletController } from "@/controllers/WalletController";
import { PosController } from "@/controllers/PosController";
import { TopupController } from "@/controllers/TopupController";
import { ReturnController } from "@/controllers/ReturnController";
import { RefundController } from "@/controllers/RefundController";
import { FamilyController } from "@/controllers/FamilyController";
import { SyncController } from "@/controllers/SyncController";
import { SpendingGroupController } from "@/controllers/SpendingGroupController";
import { UomController } from "@/controllers/UomController";
import { CardholderController } from "@/controllers/CardholderController";
import { CustomerDisplayController } from "@/controllers/CustomerDisplayController";
import { AdminImportController } from "@/controllers/AdminImportController";
import { AdminReportsController } from "@/controllers/AdminReportsController";
import { CanteenController } from "@/controllers/CanteenController";
import * as HealthSchema from "@/interfaces/routes/health.schema";
import * as AuthSchema from "@/interfaces/routes/auth.schema";
import * as IsbSyncSchema from "@/interfaces/routes/isb_sync.schema";
import * as BayCallbackSchema from "@/interfaces/routes/bay_callback.schema";
import * as AdminSettingsSchema from "@/interfaces/routes/admin_settings.schema";
import * as CustomerDisplaySchema from "@/interfaces/routes/customer_display.schema";
import * as DepartmentSchema from "@/interfaces/routes/department.schema";
import * as UserSchema from "@/interfaces/routes/user.schema";
import * as UsersAdminSchema from "@/interfaces/routes/users_admin.schema";
import * as AdminAuditSchema from "@/interfaces/routes/admin_audit.schema";
import * as CustomerSchema from "@/interfaces/routes/customer.schema";
import * as ProductSchema from "@/interfaces/routes/product.schema";
import * as ReportSchema from "@/interfaces/routes/report.schema";
import * as ShopSchema from "@/interfaces/routes/shop.schema";
import * as ShopCatalogSchema from "@/interfaces/routes/shop_catalog.schema";
import * as WalletSchema from "@/interfaces/routes/wallet.schema";
import * as PosSchema from "@/interfaces/routes/pos.schema";
import * as TopupSchema from "@/interfaces/routes/topup.schema";
import * as ReturnSchema from "@/interfaces/routes/return.schema";
import * as RefundSchema from "@/interfaces/routes/refund.schema";
import * as FamilySchema from "@/interfaces/routes/family.schema";
import * as SyncSchema from "@/interfaces/routes/sync.schema";
import * as SpendingGroupSchema from "@/interfaces/routes/spending_group.schema";
import * as UomSchema from "@/interfaces/routes/uom.schema";
import * as CardholderSchema from "@/interfaces/routes/cardholder.schema";
import * as AdminImportSchema from "@/interfaces/routes/admin_import.schema";
import * as AdminReportsSchema from "@/interfaces/routes/admin_reports.schema";
import * as CanteenSchema from "@/interfaces/routes/canteen.schema";

/** ISB vendor sync — public, x-api-key only (no JWT). */
const isbSyncPlugin = new Elysia({ name: "isb-sync", prefix: "/api/v1" })
    .onError(({ code, error, set }) => {
        if (code === "VALIDATION") {
            return syncValidationFailed(set, mapValidationError(error));
        }
    })
    .post("/sync/staffs", IsbSyncController.staffs, IsbSyncSchema.isbSyncStaffs)
    .post("/sync/families", IsbSyncController.families, IsbSyncSchema.isbSyncFamilies)
    .post("/sync/departments", IsbSyncController.departments, IsbSyncSchema.isbSyncDepartments);

/**
 * All authenticated /api/v1 routes in one plugin (Elysia 1.4.x: avoid multiple
 * .use() siblings inside a group — routes after the last plugin may not match).
 */
const apiV1AuthedRoutes = new Elysia({ name: "api-v1-authed-routes" })
    // ── Auth (authed) ───────────────────────────────────────────────────────
    .get("/me", AuthController.jwtMe, AuthSchema.jwtMe)
    .get("/auth/me", AuthController.me, AuthSchema.me)
    .post("/auth/logout", AuthController.logout, AuthSchema.logout)
    .get("/auth/users/:user_id/roles", AuthController.listUserRoles, AuthSchema.listUserRoles)
    .post("/auth/users/:user_id/roles", AuthController.assignRole, AuthSchema.assignRole)
    .delete("/auth/users/:user_id/roles/:role_name", AuthController.removeRole, AuthSchema.removeRole)
    // ── Departments ─────────────────────────────────────────────────────────
    .get("/departments/", DepartmentController.list, DepartmentSchema.listDepartments)
    // ── Users ───────────────────────────────────────────────────────────────
    .get("/users/", UserController.list, UserSchema.listUsers)
    .post("/users/", UserController.create, UserSchema.createUser)
    .get("/users/by-username/:username", UserController.byUsername, UserSchema.getUserByUsername)
    .get("/users/by-card/:uid", UserController.byCard, UserSchema.getUserByCard)
    .get("/users/family-lookup", UserController.familyLookup, UserSchema.familyLookup)
    .get("/users/:id", UserController.getById, UserSchema.getUserById)
    .patch("/users/:id", UserController.update, UserSchema.updateUser)
    .delete("/users/:id", UserController.remove, UserSchema.deleteUser)
    // ── Users admin ─────────────────────────────────────────────────────────
    .get("/users-admin/", UsersAdminController.list, UsersAdminSchema.listAdminUsers)
    .get("/users-admin/staff-picker", UsersAdminController.staffPicker, UsersAdminSchema.listStaffForPicker)
    .get("/users-admin/students", UsersAdminController.listStudents, UsersAdminSchema.listStudentsForLink)
    .post("/users-admin/students", UsersAdminController.createStudent, UsersAdminSchema.createAdminStudent)
    .get("/users-admin/:user_id", UsersAdminController.getById, UsersAdminSchema.getAdminUser)
    .patch("/users-admin/:user_id", UsersAdminController.update, UsersAdminSchema.updateAdminUser)
    .get("/users-admin/:user_id/family", UsersAdminController.getFamily, UsersAdminSchema.getUserFamily)
    .patch("/users-admin/family-profile/:family_code", UsersAdminController.updateFamilyProfile, UsersAdminSchema.updateFamilyProfile)
    .post("/users-admin/:user_id/link-student", UsersAdminController.linkStudent, UsersAdminSchema.linkStudentToUser)
    .delete("/users-admin/:user_id/link-student/:customer_id", UsersAdminController.unlinkStudent, UsersAdminSchema.unlinkStudent)
    // ── Admin audit & settings ──────────────────────────────────────────────
    .get("/admin/audit-logs", AdminAuditController.listAuditLogs, AdminAuditSchema.listAuditLogs)
    .get("/admin/settings/", AdminSettingsController.listKnown, AdminSettingsSchema.listKnownSettings)
    .put("/admin/settings/school", AdminSettingsController.setSchoolSettings, AdminSettingsSchema.setSchoolSettings)
    .put("/admin/settings/:key", AdminSettingsController.setValue, AdminSettingsSchema.setSettingValue)
    .post("/admin/settings/test-email", AdminSettingsController.testEmail, AdminSettingsSchema.testEmail)
    // ── Customers ───────────────────────────────────────────────────────────
    .get("/customers/search", CustomerController.search, CustomerSchema.searchCustomers)
    .get("/customers/by-code/:code", CustomerController.getByCode, CustomerSchema.getCustomerByCode)
    .get("/customers/by-card/:uid", CustomerController.getByCard, CustomerSchema.getCustomerByCard)
    .get("/customers/", CustomerController.list, CustomerSchema.listCustomers)
    .post("/customers/", CustomerController.create, CustomerSchema.createCustomer)
    .get("/customers/:id", CustomerController.getById, CustomerSchema.getCustomerById)
    .patch("/customers/:id", CustomerController.update, CustomerSchema.updateCustomer)
    .delete("/customers/:id", CustomerController.remove, CustomerSchema.deleteCustomer)
    .post("/customers/:id/freeze", CustomerController.freeze, CustomerSchema.freezeCustomerCard)
    .patch("/customers/:id/active", CustomerController.setActive, CustomerSchema.setCustomerActive)
    .patch("/customers/:id/limit", CustomerController.setLimit, CustomerSchema.setCustomerLimit)
    .patch("/customers/:id/allergies", CustomerController.updateAllergies, CustomerSchema.updateCustomerAllergies)
    .patch("/customers/:id/negative-limit", CustomerController.setNegativeLimit, CustomerSchema.setCustomerNegativeLimit)
    .patch("/customers/:id/card", CustomerController.bindCard, CustomerSchema.bindCustomerCard)
    .post("/customers/:id/graduate", CustomerController.graduate, CustomerSchema.graduateCustomer)
    // ── Products ────────────────────────────────────────────────────────────
    .get("/products/search", ProductController.search, ProductSchema.searchProducts)
    .get("/products/barcode/:barcode", ProductController.getByBarcode, ProductSchema.getProductByBarcode)
    .get("/products/", ProductController.list, ProductSchema.listProducts)
    .get("/products/:id", ProductController.getById, ProductSchema.getProductById)
    // ── Reports ───────────────────────────────────────────────────────────────
    .get("/reports/sales", ReportController.sales, ReportSchema.salesReport)
    .get("/reports/sales-by-payment", ReportController.salesByPayment, ReportSchema.salesByPaymentReport)
    .get("/reports/stock", ReportController.stock, ReportSchema.stockReport)
    .get("/reports/returns", ReportController.returns, ReportSchema.returnsReport)
    .get("/reports/stock-card", ReportController.stockCard, ReportSchema.stockCardReport)
    .get("/reports/sales-summary", ReportController.salesSummary, ReportSchema.salesSummaryReport)
    .get("/reports/sales-by-item", ReportController.salesByItem, ReportSchema.salesByItemReport)
    // ── Shops ───────────────────────────────────────────────────────────────
    .get("/shops/", ShopController.list, ShopSchema.listShops)
    .post("/shops/", ShopController.create, ShopSchema.createShop)
    .get("/shops/low-stock", ShopController.listLowStock, ShopSchema.listLowStock)
    .get("/shops/:shopId", ShopController.get, ShopSchema.getShop)
    .patch("/shops/:shopId", ShopController.update, ShopSchema.updateShop)
    .delete("/shops/:shopId", ShopController.delete, ShopSchema.deleteShop)
    .put("/shops/:shopId/void-shortcuts", ShopController.updateVoidShortcuts, ShopSchema.updateVoidShortcuts)
    .get("/shops/:shopId/stats", ShopController.stats, ShopSchema.shopStats)
    .get("/shops/:shopId/products", ShopController.listProducts, ShopSchema.listShopProducts)
    .get("/shops/:shopId/categories", ShopController.listCategories, ShopSchema.listShopCategories)
    .get("/shops/:shopId/products/:productId/barcodes", ShopController.listBarcodes, ShopSchema.listProductBarcodes)
    .post("/shops/:shopId/products/:productId/barcodes", ShopController.addBarcode, ShopSchema.addProductBarcode)
    .delete("/shops/:shopId/products/:productId/barcodes/:barcodeId", ShopController.deleteBarcode, ShopSchema.deleteProductBarcode)
    .get("/shops/:shopId/products/:productId/fifo-lots", ShopController.listFifoLots, ShopSchema.listFifoLots)
    .get("/shops/:shopId/movements", ShopController.listMovements, ShopSchema.listShopMovements)
    .get("/shops/:shopId/audit-logs", ShopController.listAuditLogs, ShopSchema.listShopAuditLogs)
    .post("/shops/:shopId/requisition", ShopController.requisition, ShopSchema.shopRequisition)
    .post("/shops/:shopId/products/reorder", ShopController.reorderProducts, ShopSchema.reorderShopProducts)
    .get("/shops/:shopId/monthly-stock-report", ShopController.monthlyStockReport, ShopSchema.monthlyStockReport)
    .get("/shops/:shopId/monthly-stock-report/export", ShopController.exportMonthlyStockReport, ShopSchema.exportMonthlyStockReport)
    .get("/shops/:shopId/close-month", ShopController.listCloseMonth, ShopSchema.listCloseMonth)
    .post("/shops/:shopId/close-month", ShopController.createCloseMonth, ShopSchema.createCloseMonth)
    .get("/shops/:shopId/close-month/:closeId", ShopController.getCloseMonth, ShopSchema.getCloseMonth)
    .patch("/shops/:shopId/close-month/:closeId/items", ShopController.patchCloseMonthItems, ShopSchema.patchCloseMonthItems)
    .post("/shops/:shopId/close-month/:closeId/import-excel", ShopController.importCloseMonthExcel, ShopSchema.importCloseMonthExcel)
    .get("/shops/:shopId/close-month/:closeId/export-excel", ShopController.exportCloseMonthExcel, ShopSchema.exportCloseMonthExcel)
    .post("/shops/:shopId/close-month/:closeId/confirm", ShopController.confirmCloseMonth, ShopSchema.confirmCloseMonth)
    // ── Shop catalog (bundles, price panels, stock) ─────────────────────────
    .get("/shops/:shopId/bundles", ShopCatalogController.listBundles, ShopCatalogSchema.listBundles)
    .get("/shops/:shopId/bundles/:bundleId", ShopCatalogController.getBundle, ShopCatalogSchema.getBundle)
    .post("/shops/:shopId/bundles", ShopCatalogController.createBundle, ShopCatalogSchema.createBundle)
    .patch("/shops/:shopId/bundles/:bundleId", ShopCatalogController.updateBundle, ShopCatalogSchema.updateBundle)
    .delete("/shops/:shopId/bundles/:bundleId", ShopCatalogController.deleteBundle, ShopCatalogSchema.deleteBundle)
    .post("/shops/:shopId/bundles/reorder", ShopCatalogController.reorderBundles, ShopCatalogSchema.reorderBundles)
    .get("/shops/:shopId/bundles/:bundleId/stock", ShopCatalogController.checkBundleStock, ShopCatalogSchema.checkBundleStock)
    .get("/shops/:shopId/price-panels", ShopCatalogController.listPricePanels, ShopCatalogSchema.listPricePanels)
    .post("/shops/:shopId/price-panels", ShopCatalogController.createPricePanel, ShopCatalogSchema.createPricePanel)
    .patch("/shops/:shopId/price-panels/:panelId", ShopCatalogController.updatePricePanel, ShopCatalogSchema.updatePricePanel)
    .delete("/shops/:shopId/price-panels/:panelId", ShopCatalogController.deletePricePanel, ShopCatalogSchema.deletePricePanel)
    .get("/shops/:shopId/price-panels/:panelId/items", ShopCatalogController.getPricePanelItems, ShopCatalogSchema.getPricePanelItems)
    .patch("/shops/:shopId/price-panels/:panelId/items/:productId", ShopCatalogController.setPricePanelItemPrice, ShopCatalogSchema.setPricePanelItemPrice)
    .patch("/shops/:shopId/price-panels/:panelId/bundle-items/:bundleId", ShopCatalogController.setPricePanelBundleItemPrice, ShopCatalogSchema.setPricePanelBundleItemPrice)
    .post("/shops/:shopId/products", ShopCatalogController.createProduct, ShopCatalogSchema.createShopProduct)
    .patch("/shops/:shopId/products/:productId", ShopCatalogController.updateProduct, ShopCatalogSchema.updateShopProduct)
    .delete("/shops/:shopId/products/:productId", ShopCatalogController.deleteProduct, ShopCatalogSchema.deleteShopProduct)
    .post("/shops/:shopId/receive", ShopCatalogController.receiveStock, ShopCatalogSchema.receiveStock)
    .post("/shops/:shopId/adjust", ShopCatalogController.adjustStock, ShopCatalogSchema.adjustStock)
    .post("/shops/:shopId/categories", ShopCatalogController.createCategory, ShopCatalogSchema.createShopCategory)
    .patch("/shops/:shopId/categories/:categoryId", ShopCatalogController.updateCategory, ShopCatalogSchema.updateShopCategory)
    .delete("/shops/:shopId/categories/:categoryId", ShopCatalogController.deleteCategory, ShopCatalogSchema.deleteShopCategory)
    // ── Wallets ─────────────────────────────────────────────────────────────
    .get("/wallets/me", WalletController.me, WalletSchema.walletMe)
    .get("/wallets/family", WalletController.family, WalletSchema.walletFamily)
    .get("/wallets/:id", WalletController.getById, WalletSchema.walletGetById)
    .get("/wallets/:id/transactions", WalletController.transactions, WalletSchema.walletTransactions)
    .post("/wallets/:id/adjust", WalletController.adjust, WalletSchema.walletAdjust)
    .post("/wallets/transfer", WalletController.transfer, WalletSchema.walletTransfer)
    // ── Top-ups & department wallet ops ─────────────────────────────────────
    .post("/wallets/:id/topup", TopupController.createIntent, TopupSchema.topupCreateIntent)
    .get("/wallets/topup/:refCode/status", TopupController.status, TopupSchema.topupStatus)
    .post("/wallets/topup/:refCode/parent-confirm", TopupController.parentConfirm, TopupSchema.topupParentConfirm)
    .post("/wallets/topup/:refCode/inquiry", TopupController.inquiry, TopupSchema.topupInquiry)
    .post("/wallets/:id/cashier-topup", TopupController.cashierTopup, TopupSchema.topupCashier)
    .post("/admin/departments/:department_id/adjust", TopupController.adjustDepartment, TopupSchema.topupAdjustDepartment)
    .get("/admin/departments/:department_id/transactions", TopupController.departmentTransactions, TopupSchema.topupDepartmentTransactions)
    .delete("/admin/departments/:department_id", TopupController.deleteDepartment, TopupSchema.topupDeleteDepartment)
    // ── POS ───────────────────────────────────────────────────────────────────
    .get("/pos/receipt", PosController.listReceipts, PosSchema.posListReceipts)
    .get("/pos/receipt/:id", PosController.getReceipt, PosSchema.posGetReceipt)
    .post("/pos/checkout", PosController.checkout, PosSchema.posCheckout)
    .post("/pos/void/:id", PosController.voidReceipt, PosSchema.posVoidReceipt)
    .post("/pos/qr-intent", PosController.createQrIntent, PosSchema.posCreateQrIntent)
    .get("/pos/qr-intent/:refCode/status", PosController.getQrIntentStatus, PosSchema.posQrIntentStatus)
    .post("/pos/qr-intent/:refCode/inquiry", PosController.inquireQrIntent, PosSchema.posQrIntentInquiry)
    .post("/pos/qr-intent/:refCode/cancel", PosController.cancelQrIntent, PosSchema.posQrIntentCancel)
    // ── Returns ─────────────────────────────────────────────────────────────
    .get("/returns", ReturnController.list, ReturnSchema.returnList)
    .get("/returns/by-receipt", ReturnController.byReceipt, ReturnSchema.returnByReceipt)
    .get("/return-history", ReturnController.history, ReturnSchema.returnHistory)
    .get("/receipts/search", ReturnController.searchReceipts, ReturnSchema.returnSearchReceipts)
    .get("/exchange/products", ReturnController.exchangeProducts, ReturnSchema.returnExchangeProducts)
    .post("/returns/create", ReturnController.create, ReturnSchema.returnCreate)
    .post("/returns/create-without-receipt", ReturnController.createWithoutReceipt, ReturnSchema.returnCreateWithoutReceipt)
    .get("/returns/:id", ReturnController.getById, ReturnSchema.returnGetById)
    .put("/returns/:id", ReturnController.update, ReturnSchema.returnUpdate)
    .delete("/returns/:id", ReturnController.remove, ReturnSchema.returnDelete)
    .post("/returns/:id/refund", ReturnController.refund, ReturnSchema.returnRefund)
    .post("/returns/:id/exchange", ReturnController.exchange, ReturnSchema.returnExchange)
    // ── Refunds ─────────────────────────────────────────────────────────────
    .get("/refund/candidates", RefundController.candidates, RefundSchema.refundCandidates)
    .get("/refund/family-search", RefundController.familySearch, RefundSchema.refundFamilySearch)
    .get("/refund/family/:family_code", RefundController.familyRoster, RefundSchema.refundFamilyRoster)
    .post("/refund/:customer_id", RefundController.create, RefundSchema.refundCreate)
    // ── Family portal ───────────────────────────────────────────────────────
    .get("/family/me", FamilyController.me, FamilySchema.familyMe)
    .get("/family/me/coparents", FamilyController.coparents, FamilySchema.familyCoparents)
    .get("/family/me/children/:child_id/low-balance-alert", FamilyController.getLowBalanceAlert, FamilySchema.familyGetLowBalanceAlert)
    .patch("/family/me/children/:child_id/low-balance-alert", FamilyController.updateLowBalanceAlert, FamilySchema.familyUpdateLowBalanceAlert)
    .get("/family/context/:student_code", FamilyController.context, FamilySchema.familyContext)
    .get("/family/by-user/:user_id", FamilyController.byUser, FamilySchema.familyByUser)
    .get("/family/links", FamilyController.listLinks, FamilySchema.familyListLinks)
    .post("/family/links", FamilyController.createLink, FamilySchema.familyCreateLink)
    .delete("/family/links/:link_id", FamilyController.deleteLink, FamilySchema.familyDeleteLink)
    .post("/family/freeze-all", FamilyController.freezeAll, FamilySchema.familyFreezeAll)
    .get("/family/orphans", FamilyController.orphans, FamilySchema.familyOrphans)
    // ── Sync ────────────────────────────────────────────────────────────────
    .post("/sync/run", SyncController.run, SyncSchema.syncRun)
    .post("/sync/powerschool", SyncController.powerschool, SyncSchema.syncPowerschool)
    .get("/sync/logs", SyncController.logs, SyncSchema.syncLogs)
    .get("/sync/stats", SyncController.stats, SyncSchema.syncStats)
    .get("/admin/sync-logs", SyncController.listSyncLogs, SyncSchema.syncListStatuses)
    .get("/admin/sync-logs/:syncLogId", SyncController.getSyncLog, SyncSchema.syncGetLog)
    .get("/admin/sync-audit/:syncLogId", SyncController.syncAudit, SyncSchema.syncAudit)
    .post("/canteen/:shopId/close-day", CanteenController.closeDay, CanteenSchema.canteenCloseDay)
    .post("/canteen/:shopId/close-day", CanteenController.closeDay, CanteenSchema.canteenCloseDay)
    // ── Spending groups ─────────────────────────────────────────────────────
    .get("/spending-groups/usage-today/by-child", SpendingGroupController.usageTodayByChild, SpendingGroupSchema.spendingGroupUsageTodayByChild)
    .get("/spending-groups/:id/usage-today", SpendingGroupController.usageToday, SpendingGroupSchema.spendingGroupUsageToday)
    .get("/spending-groups/", SpendingGroupController.list, SpendingGroupSchema.spendingGroupList)
    .post("/spending-groups/", SpendingGroupController.create, SpendingGroupSchema.spendingGroupCreate)
    .get("/spending-groups/:id", SpendingGroupController.getById, SpendingGroupSchema.spendingGroupGetById)
    .patch("/spending-groups/:id", SpendingGroupController.update, SpendingGroupSchema.spendingGroupUpdate)
    .delete("/spending-groups/:id", SpendingGroupController.remove, SpendingGroupSchema.spendingGroupDelete)
    .get("/spending-groups/:id/shops", SpendingGroupController.listShops, SpendingGroupSchema.spendingGroupListShops)
    .patch("/spending-groups/:id/shops", SpendingGroupController.setShops, SpendingGroupSchema.spendingGroupSetShops)
    // ── UOM ─────────────────────────────────────────────────────────────────
    .get("/uom/", UomController.list, UomSchema.uomList)
    .post("/uom/", UomController.create, UomSchema.uomCreate)
    .post("/uom/seed-defaults", UomController.seedDefaults, UomSchema.uomSeedDefaults)
    .get("/uom/:id", UomController.getById, UomSchema.uomGetById)
    .patch("/uom/:id", UomController.update, UomSchema.uomUpdate)
    .delete("/uom/:id", UomController.remove, UomSchema.uomDelete)
    // ── Cardholders ─────────────────────────────────────────────────────────
    .get("/admin/cardholders", CardholderController.list, CardholderSchema.cardholderList)
    .post("/admin/cardholders", CardholderController.create, CardholderSchema.cardholderCreate)
    // ── Customer display (admin) ────────────────────────────────────────────
    .post("/admin/customer-display/images", CustomerDisplayController.upload, CustomerDisplaySchema.customerDisplayUpload)
    .delete("/admin/customer-display/images/:id", CustomerDisplayController.delete, CustomerDisplaySchema.customerDisplayDelete)
    .patch("/admin/customer-display/images/order", CustomerDisplayController.reorder, CustomerDisplaySchema.customerDisplayReorder)
    // ── Admin import ────────────────────────────────────────────────────────
    .get("/admin/import/template", AdminImportController.template, AdminImportSchema.adminImportTemplate)
    .post("/admin/import/products", AdminImportController.products, AdminImportSchema.adminImportProducts)
    .post("/admin/import/stock-receive", AdminImportController.stockReceive, AdminImportSchema.adminImportStockReceive)
    .post("/admin/import/store", AdminImportController.store, AdminImportSchema.adminImportStore)
    // ── Admin reports ───────────────────────────────────────────────────────
    .get("/admin/adjustment-report", AdminReportsController.adjustmentReport, AdminReportsSchema.adminAdjustmentReport)
    .get("/admin/transfer-report", AdminReportsController.transferReport, AdminReportsSchema.adminTransferReport);

const apiV1Authed = new Elysia({ name: "api-v1-authed", prefix: "/api/v1" })
    .use(requireAuth)
    .use(apiV1AuthedRoutes);

const publicAuthPlugin = new Elysia({ name: "public-auth", prefix: "/api/v1/auth" })
    .onBeforeHandle(authRateLimit)
    .post("/login", AuthController.login, AuthSchema.login)
    .post("/refresh", AuthController.refresh, AuthSchema.refresh)
    .post("/sso/mock", AuthController.mockSso, AuthSchema.mockSso)
    .post("/sso/google", AuthController.googleSso, AuthSchema.googleSso);

const router = (app: Elysia) =>
    app
        // 1. Health (public)
        .get("/health", HealthController.get, HealthSchema.health)
        // 2. ISB sync (public, x-api-key)
        .use(isbSyncPlugin)
        // 3. Public auth, settings, payments, customer display
        .use(publicAuthPlugin)
        .get("/api/v1/admin/settings/public", PublicSettingsController.getPublicSettings, AdminSettingsSchema.getPublicSettings)
        .get("/api/v1/admin/settings/school", PublicSettingsController.getSchoolSettings, AdminSettingsSchema.getSchoolSettings)
        .post("/api/v1/bay/callback", BayCallbackController.callback, BayCallbackSchema.bayCallback)
        .get("/api/v1/customer-display/images", CustomerDisplayController.listPublic, CustomerDisplaySchema.customerDisplayListPublic)
        .get("/api/v1/customer-display/images/:id/binary", CustomerDisplayController.getBinary, CustomerDisplaySchema.customerDisplayGetBinary)
        // 4. Authenticated API bundle
        .use(apiV1Authed);

export default router;
