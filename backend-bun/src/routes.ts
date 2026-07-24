import { Elysia } from "elysia";
import { requireAuth } from "@/middleware/AuthMiddleware";
import { authRateLimit } from "@/middleware/RateLimitMiddleware";
import { HealthController } from "@/controllers/HealthController";
import { AuthController } from "@/controllers/AuthController";
import { IsbSyncController } from "@/controllers/IsbSyncController";
import { VendorWalletController } from "@/controllers/VendorWalletController";
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
import { ProfilePhotoController } from "@/controllers/ProfilePhotoController";
import { AdminImportController } from "@/controllers/AdminImportController";
import { AdminReportsController } from "@/controllers/AdminReportsController";
import { CanteenController } from "@/controllers/CanteenController";
import { KioskController } from "@/controllers/KioskController";
import { KioskMonitoringController } from "@/controllers/KioskMonitoringController";
import * as HealthSchema from "@/interfaces/routes/health.schema";
import * as AuthSchema from "@/interfaces/routes/auth.schema";
import * as IsbSyncSchema from "@/interfaces/routes/isb_sync.schema";
import * as VendorWalletSchema from "@/interfaces/routes/vendor_wallet.schema";
import * as BayCallbackSchema from "@/interfaces/routes/bay_callback.schema";
import * as AdminSettingsSchema from "@/interfaces/routes/admin_settings.schema";
import * as CustomerDisplaySchema from "@/interfaces/routes/customer_display.schema";
import * as ProfilePhotoSchema from "@/interfaces/routes/profile_photo.schema";
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
import * as KioskSchema from "@/interfaces/routes/kiosk.schema";
import * as KioskMonitoringSchema from "@/interfaces/routes/kiosk_monitoring.schema";

/**
 * ISB vendor sync + wallet-adjust-balance — public, x-api-key only (no JWT).
 * Validation-error formatting for these paths lives in app.ts's root
 * onError, not here — Elysia 1.4.x always runs the root app's onError for
 * VALIDATION on nested routes, so a plugin-level handler here never fires.
 */
/** Build a BAY return location URL for the matching Vercel React page. */
const bayReturnLocation = (outcome: "success" | "fail" | "cancel", url: string) => {
    const ref = new URL(url).searchParams.get("ref") ?? "";
    return `${process.env.FRONTEND_BASE_URL ?? ""}/payment/bay/${outcome}?ref=${encodeURIComponent(ref)}`;
};

/** ISB vendor sync — public, x-api-key only (no JWT). */
const isbSyncPlugin = new Elysia({ name: "isb-sync", prefix: "/api/v1" })
    .post("/sync/staffs", IsbSyncController.staffs, IsbSyncSchema.isbSyncStaffs)
    .post("/sync/families", IsbSyncController.families, IsbSyncSchema.isbSyncFamilies)
    .post("/sync/departments", IsbSyncController.departments, IsbSyncSchema.isbSyncDepartments)
    .post("/wallet/adjust-balance", VendorWalletController.adjustBalance, VendorWalletSchema.adjustBalance);

/**
 * All authenticated /api/v1 routes in one plugin (Elysia 1.4.x: avoid multiple
 * .use() siblings inside a group — routes after the last plugin may not match).
 */
const apiV1AuthedRoutes = new Elysia({ name: "api-v1-authed-routes" })
    // ── Auth (authed) ───────────────────────────────────────────────────────
    .get("/me", AuthController.jwtMe, AuthSchema.jwtMe)
    .group("/auth", (app) => app
        .get("/me", AuthController.me, AuthSchema.me)
        .post("/logout", AuthController.logout, AuthSchema.logout)
        .get("/users/:user_id/roles", AuthController.listUserRoles, AuthSchema.listUserRoles)
        .post("/users/:user_id/roles", AuthController.assignRole, AuthSchema.assignRole)
        .delete("/users/:user_id/roles/:role_name", AuthController.removeRole, AuthSchema.removeRole)
    )
    // ── Departments ─────────────────────────────────────────────────────────
    .get("/departments/", DepartmentController.list, DepartmentSchema.listDepartments)
    // ── Users ───────────────────────────────────────────────────────────────
    .group("/users", (app) =>
        app
            .get("/", UserController.list, UserSchema.listUsers)
            .post("/", UserController.create, UserSchema.createUser)
            .get("/by-username/:username", UserController.byUsername, UserSchema.getUserByUsername)
            .get("/by-card/:uid", UserController.byCard, UserSchema.getUserByCard)
            .get("/by-external-id/:externalId", UserController.byExternalId, UserSchema.getUserByExternalId)
            .get("/family-lookup", UserController.familyLookup, UserSchema.familyLookup)
            .get("/:id", UserController.getById, UserSchema.getUserById)
            .patch("/:id", UserController.update, UserSchema.updateUser)
            .delete("/:id", UserController.remove, UserSchema.deleteUser)
            .post("/:id/cashier-topup", TopupController.cashierTopupByUser, TopupSchema.topupCashierByUser)
    )
    // ── Users admin ─────────────────────────────────────────────────────────
    .group("/users-admin", (app) =>
        app
            .get("/", UsersAdminController.list, UsersAdminSchema.listAdminUsers)
            .get("/staff-picker", UsersAdminController.staffPicker, UsersAdminSchema.listStaffForPicker)
            .get("/students", UsersAdminController.listStudents, UsersAdminSchema.listStudentsForLink)
            .post("/students", UsersAdminController.createStudent, UsersAdminSchema.createAdminStudent)
            .get("/:user_id", UsersAdminController.getById, UsersAdminSchema.getAdminUser)
            .patch("/:user_id", UsersAdminController.update, UsersAdminSchema.updateAdminUser)
            .get("/:user_id/family", UsersAdminController.getFamily, UsersAdminSchema.getUserFamily)
            .patch("/family-profile/:family_code", UsersAdminController.updateFamilyProfile, UsersAdminSchema.updateFamilyProfile)
            .post("/:user_id/link-student", UsersAdminController.linkStudent, UsersAdminSchema.linkStudentToUser)
            .delete("/:user_id/link-student/:customer_id", UsersAdminController.unlinkStudent, UsersAdminSchema.unlinkStudent)
            .patch("/:user_id/password", UsersAdminController.changePassword, UsersAdminSchema.changePassword)
    )
    // ── Admin audit & settings ──────────────────────────────────────────────
    .group("/admin", (app) => app
        .get("/audit-logs", AdminAuditController.listAuditLogs, AdminAuditSchema.listAuditLogs)
        .get("/settings/", AdminSettingsController.listKnown, AdminSettingsSchema.listKnownSettings)
        .put("/settings/school", AdminSettingsController.setSchoolSettings, AdminSettingsSchema.setSchoolSettings)
        .put("/settings/:key", AdminSettingsController.setValue, AdminSettingsSchema.setSettingValue)
        .post("/settings/test-email", AdminSettingsController.testEmail, AdminSettingsSchema.testEmail)
        .post("/topups/reconcile", TopupController.reconcile, TopupSchema.topupReconcile)
    )
    // ── Customers ───────────────────────────────────────────────────────────
    .group("/customers", (app) =>
        app
            .get("/search", CustomerController.search, CustomerSchema.searchCustomers)
            .get("/by-code/:code", CustomerController.getByCode, CustomerSchema.getCustomerByCode)
            .get("/by-card/:uid", CustomerController.getByCard, CustomerSchema.getCustomerByCard)
            .get("/", CustomerController.list, CustomerSchema.listCustomers)
            .post("/", CustomerController.create, CustomerSchema.createCustomer)
            .get("/:id", CustomerController.getById, CustomerSchema.getCustomerById)
            .patch("/:id", CustomerController.update, CustomerSchema.updateCustomer)
            .delete("/:id", CustomerController.remove, CustomerSchema.deleteCustomer)
            .post("/:id/freeze", CustomerController.freeze, CustomerSchema.freezeCustomerCard)
            .patch("/:id/active", CustomerController.setActive, CustomerSchema.setCustomerActive)
            .patch("/:id/limit", CustomerController.setLimit, CustomerSchema.setCustomerLimit)
            .patch("/:id/allergies", CustomerController.updateAllergies, CustomerSchema.updateCustomerAllergies)
            .patch("/:id/negative-limit", CustomerController.setNegativeLimit, CustomerSchema.setCustomerNegativeLimit)
            .patch("/:id/card", CustomerController.bindCard, CustomerSchema.bindCustomerCard)
            .post("/:id/graduate", CustomerController.graduate, CustomerSchema.graduateCustomer)
            .post("/:id/cashier-topup", TopupController.cashierTopupByCustomer, TopupSchema.topupCashierByCustomer)
    )
    // ── Products ────────────────────────────────────────────────────────────
    .group("/products", (app) =>
        app
            .get("/search", ProductController.search, ProductSchema.searchProducts)
            .get("/barcode/:barcode", ProductController.getByBarcode, ProductSchema.getProductByBarcode)
            .get("/", ProductController.list, ProductSchema.listProducts)
            .get("/:id", ProductController.getById, ProductSchema.getProductById)
    )
    // ── Reports ───────────────────────────────────────────────────────────────
    .group("/reports", (app) =>
        app
            .get("/sales", ReportController.sales, ReportSchema.salesReport)
            .get("/sales-by-payment", ReportController.salesByPayment, ReportSchema.salesByPaymentReport)
            .get("/stock", ReportController.stock, ReportSchema.stockReport)
            .get("/returns", ReportController.returns, ReportSchema.returnsReport)
            .get("/voids", ReportController.voidReceipts, ReportSchema.voidReport)
            .get("/stock-card", ReportController.stockCard, ReportSchema.stockCardReport)
            .get("/sales-summary", ReportController.salesSummary, ReportSchema.salesSummaryReport)
            .get("/sales-by-item", ReportController.salesByItem, ReportSchema.salesByItemReport)
            .get("/bundle-report", ReportController.bundle, ReportSchema.bundleReport)
            .get("/internal-used", ReportController.internalUsed, ReportSchema.internalUsedReport)
    )
    // ── Shops ───────────────────────────────────────────────────────────────
    .group("/shops", (app) =>
        app
            .get("/", ShopController.list, ShopSchema.listShops)
            .post("/", ShopController.create, ShopSchema.createShop)
            .get("/low-stock", ShopController.listLowStock, ShopSchema.listLowStock)
            .get("/:shopId", ShopController.get, ShopSchema.getShop)
            .patch("/:shopId", ShopController.update, ShopSchema.updateShop)
            .delete("/:shopId", ShopController.delete, ShopSchema.deleteShop)
            .put("/:shopId/void-shortcuts", ShopController.updateVoidShortcuts, ShopSchema.updateVoidShortcuts)
            .get("/:shopId/spending-groups", ShopController.listSpendingGroups, ShopSchema.listShopSpendingGroups)
            .patch("/:shopId/spending-groups", ShopController.setSpendingGroups, ShopSchema.setShopSpendingGroups)
            .get("/:shopId/stats", ShopController.stats, ShopSchema.shopStats)
            .get("/:shopId/products", ShopController.listProducts, ShopSchema.listShopProducts)
            .get("/:shopId/categories", ShopController.listCategories, ShopSchema.listShopCategories)
            .get("/:shopId/products/:productId/barcodes", ShopController.listBarcodes, ShopSchema.listProductBarcodes)
            .post("/:shopId/products/:productId/barcodes", ShopController.addBarcode, ShopSchema.addProductBarcode)
            .delete("/:shopId/products/:productId/barcodes/:barcodeId", ShopController.deleteBarcode, ShopSchema.deleteProductBarcode)
            .get("/:shopId/products/:productId/fifo-lots", ShopController.listFifoLots, ShopSchema.listFifoLots)
            .get("/:shopId/movements", ShopController.listMovements, ShopSchema.listShopMovements)
            .get("/:shopId/audit-logs", ShopController.listAuditLogs, ShopSchema.listShopAuditLogs)
            .post("/:shopId/requisition", ShopController.requisition, ShopSchema.shopRequisition)
            .post("/:shopId/products/reorder", ShopController.reorderProducts, ShopSchema.reorderShopProducts)
            .get("/:shopId/monthly-stock-report", ShopController.monthlyStockReport, ShopSchema.monthlyStockReport)
            .get("/:shopId/monthly-stock-report/export", ShopController.exportMonthlyStockReport, ShopSchema.exportMonthlyStockReport)
            .get("/:shopId/balance-file", ShopController.balanceFile, ShopSchema.balanceFile)
            .get("/:shopId/balance-file/export", ShopController.exportBalanceFile, ShopSchema.exportBalanceFile)
            .get("/:shopId/close-month", ShopController.listCloseMonth, ShopSchema.listCloseMonth)
            .post("/:shopId/close-month", ShopController.createCloseMonth, ShopSchema.createCloseMonth)
            .get("/:shopId/close-month/:closeId", ShopController.getCloseMonth, ShopSchema.getCloseMonth)
            .patch("/:shopId/close-month/:closeId/items", ShopController.patchCloseMonthItems, ShopSchema.patchCloseMonthItems)
            .post("/:shopId/close-month/:closeId/import-excel", ShopController.importCloseMonthExcel, ShopSchema.importCloseMonthExcel)
            .get("/:shopId/close-month/:closeId/export-excel", ShopController.exportCloseMonthExcel, ShopSchema.exportCloseMonthExcel)
            .post("/:shopId/close-month/:closeId/confirm", ShopController.confirmCloseMonth, ShopSchema.confirmCloseMonth)
            // ── Shop catalog (bundles, price panels, stock) ─────────────────────────
            .get("/:shopId/bundles", ShopCatalogController.listBundles, ShopCatalogSchema.listBundles)
            .get("/:shopId/bundles/:bundleId", ShopCatalogController.getBundle, ShopCatalogSchema.getBundle)
            .post("/:shopId/bundles", ShopCatalogController.createBundle, ShopCatalogSchema.createBundle)
            .patch("/:shopId/bundles/:bundleId", ShopCatalogController.updateBundle, ShopCatalogSchema.updateBundle)
            .delete("/:shopId/bundles/:bundleId", ShopCatalogController.deleteBundle, ShopCatalogSchema.deleteBundle)
            .post("/:shopId/bundles/reorder", ShopCatalogController.reorderBundles, ShopCatalogSchema.reorderBundles)
            .get("/:shopId/bundles/:bundleId/stock", ShopCatalogController.checkBundleStock, ShopCatalogSchema.checkBundleStock)
            .get("/:shopId/price-panels", ShopCatalogController.listPricePanels, ShopCatalogSchema.listPricePanels)
            .post("/:shopId/price-panels", ShopCatalogController.createPricePanel, ShopCatalogSchema.createPricePanel)
            .patch("/:shopId/price-panels/:panelId", ShopCatalogController.updatePricePanel, ShopCatalogSchema.updatePricePanel)
            .delete("/:shopId/price-panels/:panelId", ShopCatalogController.deletePricePanel, ShopCatalogSchema.deletePricePanel)
            .get("/:shopId/price-panels/:panelId/items", ShopCatalogController.getPricePanelItems, ShopCatalogSchema.getPricePanelItems)
            .patch("/:shopId/price-panels/:panelId/items/:productId", ShopCatalogController.setPricePanelItemPrice, ShopCatalogSchema.setPricePanelItemPrice)
            .patch("/:shopId/price-panels/:panelId/bundle-items/:bundleId", ShopCatalogController.setPricePanelBundleItemPrice, ShopCatalogSchema.setPricePanelBundleItemPrice)
            .post("/:shopId/products", ShopCatalogController.createProduct, ShopCatalogSchema.createShopProduct)
            .patch("/:shopId/products/:productId", ShopCatalogController.updateProduct, ShopCatalogSchema.updateShopProduct)
            .delete("/:shopId/products/:productId", ShopCatalogController.deleteProduct, ShopCatalogSchema.deleteShopProduct)
            .post("/:shopId/receive", ShopCatalogController.receiveStock, ShopCatalogSchema.receiveStock)
            .post("/:shopId/adjust", ShopCatalogController.adjustStock, ShopCatalogSchema.adjustStock)
            .post("/:shopId/categories", ShopCatalogController.createCategory, ShopCatalogSchema.createShopCategory)
            .patch("/:shopId/categories/:categoryId", ShopCatalogController.updateCategory, ShopCatalogSchema.updateShopCategory)
            .delete("/:shopId/categories/:categoryId", ShopCatalogController.deleteCategory, ShopCatalogSchema.deleteShopCategory)
    )
    // ── Wallets ─────────────────────────────────────────────────────────────
    .group("/wallets", (app) =>
        app
            .get("/me", WalletController.me, WalletSchema.walletMe)
            .get("/family", WalletController.family, WalletSchema.walletFamily)
            .get("/:id", WalletController.getById, WalletSchema.walletGetById)
            .get("/:id/transactions", WalletController.transactions, WalletSchema.walletTransactions)
            .post("/:id/adjust", WalletController.adjust, WalletSchema.walletAdjust)
            .post("/transfer", WalletController.transfer, WalletSchema.walletTransfer)
            // ── Top-ups & department wallet ops ─────────────────────────────────────
            .post("/:id/topup", TopupController.createIntent, TopupSchema.topupCreateIntent)
            .get("/topup/:refCode/status", TopupController.status, TopupSchema.topupStatus)
            .post("/topup/:refCode/parent-confirm", TopupController.parentConfirm, TopupSchema.topupParentConfirm)
            .post("/topup/:refCode/inquiry", TopupController.inquiry, TopupSchema.topupInquiry)
            .post("/topup/:refCode/cancel", TopupController.cancelIntent, TopupSchema.topupCancelIntent)
            .post("/:id/cashier-topup", TopupController.cashierTopup, TopupSchema.topupCashier)
    )
    // ── Kiosk device ──────────────────────────────────────────────────────────
    .group("/kiosk", (app) =>
        app
            .get("/me", KioskController.me, KioskSchema.kioskMe)
            .patch("/me/location", KioskController.updateLocation, KioskSchema.kioskUpdateLocation)
            .post("/logs", KioskController.uploadLogs, KioskSchema.kioskUploadLogs)
            .post("/heartbeat", KioskController.heartbeat, KioskSchema.kioskHeartbeat)
    )
    .group("/admin/departments", (app) =>
        app
            .post("/:department_id/adjust", TopupController.adjustDepartment, TopupSchema.topupAdjustDepartment)
            .get("/:department_id/transactions", TopupController.departmentTransactions, TopupSchema.topupDepartmentTransactions)
            .patch("/:department_id", TopupController.updateDepartment, TopupSchema.topupUpdateDepartment)
            .delete("/:department_id", TopupController.deleteDepartment, TopupSchema.topupDeleteDepartment)
    )
    // ── POS ───────────────────────────────────────────────────────────────────
    .group("/pos", (app) =>
        app
            .get("/receipt", PosController.listReceipts, PosSchema.posListReceipts)
            .get("/receipt/:id", PosController.getReceipt, PosSchema.posGetReceipt)
            .post("/checkout", PosController.checkout, PosSchema.posCheckout)
            .post("/void/:id", PosController.voidReceipt, PosSchema.posVoidReceipt)
            .post("/qr-intent", PosController.createQrIntent, PosSchema.posCreateQrIntent)
            .get("/qr-intent/:refCode/status", PosController.getQrIntentStatus, PosSchema.posQrIntentStatus)
            .post("/qr-intent/:refCode/inquiry", PosController.inquireQrIntent, PosSchema.posQrIntentInquiry)
            .post("/qr-intent/:refCode/cancel", PosController.cancelQrIntent, PosSchema.posQrIntentCancel)
    )
    // ── Returns ─────────────────────────────────────────────────────────────
    .group("/returns", (app) =>
        app
            .get("/", ReturnController.list, ReturnSchema.returnList)
            .get("/by-receipt", ReturnController.byReceipt, ReturnSchema.returnByReceipt)
            .get("/history", ReturnController.history, ReturnSchema.returnHistory)
            .get("/receipts/search", ReturnController.searchReceipts, ReturnSchema.returnSearchReceipts)
            .get("/exchange/products", ReturnController.exchangeProducts, ReturnSchema.returnExchangeProducts)
            .post("/create", ReturnController.create, ReturnSchema.returnCreate)
            .post("/create-without-receipt", ReturnController.createWithoutReceipt, ReturnSchema.returnCreateWithoutReceipt)
            .get("/:id", ReturnController.getById, ReturnSchema.returnGetById)
            .put("/:id", ReturnController.update, ReturnSchema.returnUpdate)
            .delete("/:id", ReturnController.remove, ReturnSchema.returnDelete)
            .post("/:id/refund", ReturnController.refund, ReturnSchema.returnRefund)
            .post("/:id/exchange", ReturnController.exchange, ReturnSchema.returnExchange)
    )
    // ── Refunds ─────────────────────────────────────────────────────────────
    .group("/refund", (app) =>
        app
            .get("/candidates", RefundController.candidates, RefundSchema.refundCandidates)
            .get("/family-search", RefundController.familySearch, RefundSchema.refundFamilySearch)
            .get("/family/:family_code", RefundController.familyRoster, RefundSchema.refundFamilyRoster)
            .post("/:customer_id", RefundController.create, RefundSchema.refundCreate)
    )
    // ── Family portal ───────────────────────────────────────────────────────
    .group("/family", (app) =>
        app
            .get("/me", FamilyController.me, FamilySchema.familyMe)
            .get("/me/coparents", FamilyController.coparents, FamilySchema.familyCoparents)
            .get("/me/children/:child_id/low-balance-alert", FamilyController.getLowBalanceAlert, FamilySchema.familyGetLowBalanceAlert)
            .patch("/me/children/:child_id/low-balance-alert", FamilyController.updateLowBalanceAlert, FamilySchema.familyUpdateLowBalanceAlert)
            .get("/context/:student_code", FamilyController.context, FamilySchema.familyContext)
            .get("/by-user/:user_id", FamilyController.byUser, FamilySchema.familyByUser)
            .get("/links", FamilyController.listLinks, FamilySchema.familyListLinks)
            .post("/links", FamilyController.createLink, FamilySchema.familyCreateLink)
            .delete("/links/:link_id", FamilyController.deleteLink, FamilySchema.familyDeleteLink)
            .post("/freeze-all", FamilyController.freezeAll, FamilySchema.familyFreezeAll)
            .get("/orphans", FamilyController.orphans, FamilySchema.familyOrphans)
    )
    // ── Sync ────────────────────────────────────────────────────────────────
    .group("/sync", (app) =>
        app
            .get("/logs", SyncController.logs, SyncSchema.syncLogs)
            .get("/stats", SyncController.stats, SyncSchema.syncStats)
    )
    .get("/admin/sync-logs", SyncController.listSyncLogs, SyncSchema.syncListStatuses)
    .get("/admin/sync-logs/:syncLogId", SyncController.getSyncLog, SyncSchema.syncGetLog)
    .get("/admin/sync-audit/:syncLogId", SyncController.syncAudit, SyncSchema.syncAudit)
    // Manual Sync — captured ISB payloads, replayed on demand (see sync_capture_service.ts)
    .get("/admin/sync-captures/:channel", SyncController.listCaptures, SyncSchema.syncCapturesList)
    .get("/admin/sync-captures/:channel/:roundId", SyncController.previewCapture, SyncSchema.syncCapturesPreview)
    .post("/admin/sync-captures/:channel/:roundId/run", SyncController.runCapture, SyncSchema.syncCapturesRun)
    .post("/canteen/:shopId/close-day", CanteenController.closeDay, CanteenSchema.canteenCloseDay)
    // ── Spending groups ─────────────────────────────────────────────────────
    .group("/spending-groups", (app) =>
        app
            .get("/usage-today/by-child", SpendingGroupController.usageTodayByChild, SpendingGroupSchema.spendingGroupUsageTodayByChild)
            .get("/:id/usage-today", SpendingGroupController.usageToday, SpendingGroupSchema.spendingGroupUsageToday)
            .get("/", SpendingGroupController.list, SpendingGroupSchema.spendingGroupList)
            .post("/", SpendingGroupController.create, SpendingGroupSchema.spendingGroupCreate)
            .get("/:id", SpendingGroupController.getById, SpendingGroupSchema.spendingGroupGetById)
            .patch("/:id", SpendingGroupController.update, SpendingGroupSchema.spendingGroupUpdate)
            .delete("/:id", SpendingGroupController.remove, SpendingGroupSchema.spendingGroupDelete)
            .get("/:id/shops", SpendingGroupController.listShops, SpendingGroupSchema.spendingGroupListShops)
            .patch("/:id/shops", SpendingGroupController.setShops, SpendingGroupSchema.spendingGroupSetShops)
    )
    // ── UOM ─────────────────────────────────────────────────────────────────
    .group("/uom", (app) =>
        app
            .get("/", UomController.list, UomSchema.uomList)
            .post("/", UomController.create, UomSchema.uomCreate)
            .post("/seed-defaults", UomController.seedDefaults, UomSchema.uomSeedDefaults)
            .get("/:id", UomController.getById, UomSchema.uomGetById)
            .patch("/:id", UomController.update, UomSchema.uomUpdate)
            .delete("/:id", UomController.remove, UomSchema.uomDelete)
    )
    // ── Cardholders ─────────────────────────────────────────────────────────
    .group("/admin/cardholders", (app) =>
        app
            .get("/", CardholderController.list, CardholderSchema.cardholderList)
            .post("/", CardholderController.create, CardholderSchema.cardholderCreate)
    )
    // ── Customer display (admin) ────────────────────────────────────────────
    .group("/admin/customer-display", (app) =>
        app
            .post("/images", CustomerDisplayController.upload, CustomerDisplaySchema.customerDisplayUpload)
            .delete("/images/:id", CustomerDisplayController.delete, CustomerDisplaySchema.customerDisplayDelete)
            .patch("/images/order", CustomerDisplayController.reorder, CustomerDisplaySchema.customerDisplayReorder)
    )
    // ── Admin import ────────────────────────────────────────────────────────
    .group("/admin/import", (app) =>
        app
            .get("/template", AdminImportController.template, AdminImportSchema.adminImportTemplate)
            .post("/products", AdminImportController.products, AdminImportSchema.adminImportProducts)
            .post("/stock-receive", AdminImportController.stockReceive, AdminImportSchema.adminImportStockReceive)
            .post("/store", AdminImportController.store, AdminImportSchema.adminImportStore)
    )
    // ── Admin reports ───────────────────────────────────────────────────────
    .get("/wallets/admin/adjustment-report", AdminReportsController.adjustmentReport, AdminReportsSchema.adminAdjustmentReport)
    .get("/wallets/admin/transfer-report", AdminReportsController.transferReport, AdminReportsSchema.adminTransferReport)
    .get("/wallets/admin/topup-report", AdminReportsController.topupReport, AdminReportsSchema.adminTopupReport)
    .get("/wallets/admin/transaction-report", AdminReportsController.transactionReport, AdminReportsSchema.adminTransactionReport)
    .get("/wallets/admin/internal-used-report", AdminReportsController.internalUsedReport, AdminReportsSchema.adminInternalUsedReport)
    .get("/admin/kiosk-logs", AdminReportsController.kioskLogReport, AdminReportsSchema.adminKioskLogReport)
    // ── Admin: kiosk online/offline monitoring ─────────────────────────────
    .group("/admin/kiosk-monitoring", (app) =>
        app
            .get("/", KioskMonitoringController.list, KioskMonitoringSchema.kioskMonitoringList)
            .put("/:kiosk_user_id/custodians", KioskMonitoringController.setCustodians, KioskMonitoringSchema.kioskMonitoringSetCustodians)
    );

const apiV1Authed = new Elysia({ name: "api-v1-authed", prefix: "/api/v1" })
    .use(requireAuth)
    .use(apiV1AuthedRoutes);

const publicAuthPlugin = new Elysia({ name: "public-auth", prefix: "/api/v1/auth" })
    .onBeforeHandle(authRateLimit)
    .post("/login", AuthController.login, AuthSchema.login)
    .post("/refresh", AuthController.refresh, AuthSchema.refresh)
    .post("/sso/mock", AuthController.mockSso, AuthSchema.mockSso)
    .post("/sso/google", AuthController.googleSso, AuthSchema.googleSso)
    .post("/sso/google/callback", AuthController.googleSsoCallback, AuthSchema.googleSsoCallback);

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
        // BAY EASYPay browser-return endpoints — BAY POST-redirects the user's
        // browser here after card payment. Backend 302 GET-redirects to the React
        // page because Vercel static hosting returns 405 for POST requests.
        // BAY POSTs (form submit) for the happy-path redirect; the user's
        // "Done" click on the BAY error page comes through as a plain GET.
        // Register both verbs for every outcome so the customer always
        // reaches the matching React page on Vercel instead of a 404.
        .post("/api/v1/payment/bay/return/success", ({ request, set }) => {
            set.status = 302;
            set.headers["Location"] = bayReturnLocation("success", request.url);
            return null;
        })
        .get("/api/v1/payment/bay/return/success", ({ request, set }) => {
            set.status = 302;
            set.headers["Location"] = bayReturnLocation("success", request.url);
            return null;
        })
        .post("/api/v1/payment/bay/return/fail", ({ request, set }) => {
            set.status = 302;
            set.headers["Location"] = bayReturnLocation("fail", request.url);
            return null;
        })
        .get("/api/v1/payment/bay/return/fail", ({ request, set }) => {
            set.status = 302;
            set.headers["Location"] = bayReturnLocation("fail", request.url);
            return null;
        })
        .post("/api/v1/payment/bay/return/cancel", ({ request, set }) => {
            set.status = 302;
            set.headers["Location"] = bayReturnLocation("cancel", request.url);
            return null;
        })
        .get("/api/v1/payment/bay/return/cancel", ({ request, set }) => {
            set.status = 302;
            set.headers["Location"] = bayReturnLocation("cancel", request.url);
            return null;
        })
        .get("/api/v1/customer-display/images", CustomerDisplayController.listPublic, CustomerDisplaySchema.customerDisplayListPublic)
        .get("/api/v1/customer-display/images/:id/binary", CustomerDisplayController.getBinary, CustomerDisplaySchema.customerDisplayGetBinary)
        .get("/api/v1/profile-photos/:filename", ProfilePhotoController.getBinary, ProfilePhotoSchema.profilePhotoGetBinary)
        // 4. Authenticated API bundle
        .use(apiV1Authed);

export default router;
