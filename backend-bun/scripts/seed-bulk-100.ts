/**
 * Bulk seed: +100 new rows into every "business" table (skips pure
 * reference/lookup tables — roles, permissions, system_settings,
 * customer_types, units_of_measure, alembic_version — and app-generated
 * log tables — audit_logs, sync_logs, sync_audit_logs, email_alerts_log).
 *
 * All generated identifiers are tagged with a per-run SEED<runTag> prefix
 * so this batch can be found/cleaned up later without touching real data.
 *
 * Usage: bun scripts/seed-bulk-100.ts
 */
import { db, pgClient } from "../src/db/client";
import { encodePassword } from "../src/utils/AuthUtils";
import {
    spendingGroups,
    categories,
    familyProfiles,
    departments,
    shops,
    shopCategories,
    pricePanels,
    productBundles,
    shopProducts,
    products,
    users,
    customers,
    productVariants,
    wallets,
    menuOptionGroups,
    bundleItems,
    pricePanelItems,
    parentChildLinks,
    barcodes,
    productBarcodes,
    stockLevels,
    fifoLots,
    shopMovements,
    productOrderHistory,
    customerDisplayImages,
    identityMappings,
    menuOptions,
    walletTransactions,
    inventoryTransactions,
    stockMovements,
    budgetTransactions,
    approvalRequests,
    paymentIntents,
    receipts,
    stockPeriodCloses,
    receiptItems,
    creditNotes,
    returnRequests,
    stockPeriodCloseItems,
} from "../src/db/schema";

const N = 100;
const runTag = Date.now().toString(36).slice(-6); // short, unique-enough per run
const TAG = `SD${runTag}`; // kept short: family_code/student_code are varchar(20)

function pad(n: number, width = 4): string {
    return String(n).padStart(width, "0");
}
function pick<T>(arr: T[], i: number): T {
    return arr[i % arr.length];
}
function randInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randMoney(min: number, max: number): string {
    return (Math.random() * (max - min) + min).toFixed(2);
}

const THAI_FIRST = ["สมชาย", "สมหญิง", "วิชัย", "นิภา", "ประยุทธ์", "อรทัย", "กิตติ", "สุดา", "ธนากร", "พรทิพย์", "อนุชา", "ศิริพร", "วีระ", "จิราพร", "ณัฐพล"];
const THAI_LAST = ["ใจดี", "รักเรียน", "สายบัว", "ทองแท้", "ศรีสุข", "เจริญพร", "มั่นคง", "แสงทอง", "บุญมี", "วงศ์สกุล"];
const SHOP_NAMES = ["Canteen", "Snack Corner", "Book Nook", "Uniform Shop", "Drinks Stand", "Bakery", "Noodle Bar", "Rice Station", "Fruit Stand", "Stationery"];
const PRODUCT_NAMES = ["ข้าวผัด", "ก๋วยเตี๋ยว", "น้ำเปล่า", "นมกล่อง", "ขนมปัง", "แซนวิช", "สมุด", "ปากกา", "ดินสอ", "ยางลบ", "ไข่ต้ม", "ผลไม้รวม", "น้ำผลไม้", "ขนมขบเคี้ยว", "ข้าวเหนียวหมูปิ้ง"];

function thaiName(i: number): string {
    return `${pick(THAI_FIRST, i)} ${pick(THAI_LAST, i + 7)}`;
}

async function main() {
    console.log(`Seeding +${N} rows per business table. Tag: ${TAG}\n`);

    // ── Tier 0: no FK deps ──────────────────────────────────────────────
    const newSpendingGroups = await db.insert(spendingGroups).values(
        Array.from({ length: N }, (_, i) => ({
            code: `${TAG}-SG-${pad(i)}`,
            nameEn: `Seed Spending Group ${i}`,
            nameTh: `กลุ่มค่าใช้จ่ายทดสอบ ${i}`,
            dailyLimit: randMoney(50, 500),
            isActive: true,
        })),
    ).returning({ id: spendingGroups.id });
    console.log(`spending_groups: +${newSpendingGroups.length}`);

    const newCategories = await db.insert(categories).values(
        Array.from({ length: N }, (_, i) => ({
            name: `${TAG} Category ${i}`,
            description: `Seed category ${i}`,
            isActive: true,
        })),
    ).returning({ id: categories.id });
    console.log(`categories: +${newCategories.length}`);

    const newFamilyProfiles = await db.insert(familyProfiles).values(
        Array.from({ length: N }, (_, i) => ({
            familyCode: `${TAG}-FAM-${pad(i)}`,
            notificationEmails: [`${TAG.toLowerCase()}-fam${pad(i)}@seed.local`],
            loginIds: [],
        })),
    ).returning({ familyCode: familyProfiles.familyCode });
    console.log(`family_profiles: +${newFamilyProfiles.length}`);

    // ── Tier 1 ──────────────────────────────────────────────────────────
    const newDepartments = await db.insert(departments).values(
        Array.from({ length: N }, (_, i) => ({
            departmentCode: `${TAG}-DPT-${pad(i)}`,
            departmentName: `Seed Department ${i}`,
            annualBudget: randMoney(10000, 500000),
            currentYear: new Date().getFullYear(),
            isActive: true,
        })),
    ).returning({ id: departments.id });
    console.log(`departments: +${newDepartments.length}`);

    const newShops = await db.insert(shops).values(
        Array.from({ length: N }, (_, i) => ({
            id: `${TAG.toLowerCase()}-shop-${pad(i)}`,
            name: `${pick(SHOP_NAMES, i)} ${i}`,
            shopType: (i % 2 === 0 ? "avg_cost" : "fifo") as "avg_cost" | "fifo",
            description: `Seed shop ${i}`,
            isActive: true,
            allowDepartmentCharge: i % 3 === 0,
            spendingGroupId: pick(newSpendingGroups, i).id,
        })),
    ).returning({ id: shops.id });
    console.log(`shops: +${newShops.length}`);

    // ── Tier 2 ──────────────────────────────────────────────────────────
    const newShopCategories = await db.insert(shopCategories).values(
        Array.from({ length: N }, (_, i) => ({
            id: `${TAG.toLowerCase()}-shopcat-${pad(i)}`,
            shopId: pick(newShops, i).id,
            name: `Seed Shop Category ${i}`,
        })),
    ).returning({ id: shopCategories.id });
    console.log(`shop_categories: +${newShopCategories.length}`);

    const newPricePanels = await db.insert(pricePanels).values(
        Array.from({ length: N }, (_, i) => ({
            shopId: pick(newShops, i).id,
            name: `Seed Price Panel ${i}`,
            sortOrder: i,
        })),
    ).returning({ id: pricePanels.id });
    console.log(`price_panels: +${newPricePanels.length}`);

    const newProductBundles = await db.insert(productBundles).values(
        Array.from({ length: N }, (_, i) => ({
            shopId: pick(newShops, i).id,
            bundleCode: `${TAG}-BDL-${pad(i)}`,
            name: `Seed Bundle ${i}`,
            externalPrice: randMoney(20, 150),
            internalPrice: randMoney(15, 120),
            sortOrder: i,
            isActive: true,
        })),
    ).returning({ id: productBundles.id });
    console.log(`product_bundles: +${newProductBundles.length}`);

    const newShopProducts = await db.insert(shopProducts).values(
        Array.from({ length: N }, (_, i) => ({
            shopId: pick(newShops, i).id,
            productCode: `${TAG}-SP-${pad(i)}`,
            barcode: `${TAG}${pad(i, 8)}`,
            name: `${pick(PRODUCT_NAMES, i)} ${i}`,
            category: pick(PRODUCT_NAMES, i + 3),
            externalPrice: randMoney(10, 100),
            internalPrice: randMoney(8, 80),
            vatPercent: "7.00",
            avgCost: randMoney(5, 60),
            stock: randInt(0, 200),
            minStock: 10,
            isActive: true,
        })),
    ).returning({ id: shopProducts.id });
    console.log(`shop_products: +${newShopProducts.length}`);

    const newProducts = await db.insert(products).values(
        Array.from({ length: N }, (_, i) => ({
            name: `${TAG} Product ${i}`,
            description: `Seed product ${i}`,
            categoryId: pick(newCategories, i).id,
            brand: `SeedBrand${i % 10}`,
            isActive: true,
        })),
    ).returning({ id: products.id });
    console.log(`products: +${newProducts.length}`);

    const seedPasswordHash = await encodePassword("SeedPass1234!");
    const ROLES = ["parent", "staff", "cashier", "manager", "kitchen"];
    const newUsers = await db.insert(users).values(
        Array.from({ length: N }, (_, i) => ({
            username: `${TAG.toLowerCase()}_user_${pad(i)}`,
            email: `${TAG.toLowerCase()}.user${pad(i)}@seed.local`,
            fullName: thaiName(i),
            hashedPassword: seedPasswordHash,
            isActive: true,
            isSuperuser: false,
            role: pick(ROLES, i),
            departmentId: pick(newDepartments, i).id,
            familyCode: newFamilyProfiles[i % newFamilyProfiles.length].familyCode,
            status: "active",
        })),
    ).returning({ id: users.id });
    console.log(`users: +${newUsers.length}`);

    const newCustomers = await db.insert(customers).values(
        Array.from({ length: N }, (_, i) => ({
            customerCode: `${TAG}-CUS-${pad(i)}`,
            name: thaiName(i + 3),
            customerTypeId: 1, // INTERNAL (existing reference row)
            departmentId: pick(newDepartments, i).id,
            studentCode: `${TAG}-STU-${pad(i)}`,
            grade: `G${randInt(1, 12)}`,
            cardUid: `${TAG}CARD${pad(i, 8)}`,
            cardFrozen: false,
            isActive: true,
            familyCode: newFamilyProfiles[i % newFamilyProfiles.length].familyCode,
            customerKind: "student",
        })),
    ).returning({ id: customers.id });
    console.log(`customers: +${newCustomers.length}`);

    // ── Tier 3 ──────────────────────────────────────────────────────────
    const newProductVariants = await db.insert(productVariants).values(
        Array.from({ length: N }, (_, i) => ({
            productId: pick(newProducts, i).id,
            sku: `${TAG}-SKU-${pad(i)}`,
            variantName: `Seed Variant ${i}`,
            costPrice: randMoney(5, 50),
            retailPrice: randMoney(10, 90),
            isActive: true,
        })),
    ).returning({ id: productVariants.id });
    console.log(`product_variants: +${newProductVariants.length}`);

    const newWallets = await db.insert(wallets).values(
        Array.from({ length: N }, (_, i) => ({
            customerId: newCustomers[i].id,
            balance: "0",
            isActive: true,
        })),
    ).returning({ id: wallets.id });
    console.log(`wallets: +${newWallets.length}`);

    const newMenuOptionGroups = await db.insert(menuOptionGroups).values(
        Array.from({ length: N }, (_, i) => ({
            productId: pick(newShopProducts, i).id,
            name: `Seed Option Group ${i}`,
            selectionType: (["single", "multi", "quantity"] as const)[i % 3],
            isRequired: i % 2 === 0,
            sortOrder: i,
        })),
    ).returning({ id: menuOptionGroups.id });
    console.log(`menu_option_groups: +${newMenuOptionGroups.length}`);

    const newBundleItems = await db.insert(bundleItems).values(
        Array.from({ length: N }, (_, i) => ({
            bundleId: pick(newProductBundles, i).id,
            productId: pick(newShopProducts, i + 1).id,
            quantity: randInt(1, 3),
            sortOrder: i,
        })),
    ).returning({ id: bundleItems.id });
    console.log(`bundle_items: +${newBundleItems.length}`);

    // 1:1 zip to satisfy uq_panel_product(panelId, productId)
    const newPricePanelItems = await db.insert(pricePanelItems).values(
        Array.from({ length: N }, (_, i) => ({
            panelId: newPricePanels[i].id,
            productId: newShopProducts[i].id,
            price: randMoney(10, 100),
            shortName: `Seed Item ${i}`,
            included: true,
        })),
    ).returning({ id: pricePanelItems.id });
    console.log(`price_panel_items: +${newPricePanelItems.length}`);

    // 1:1 zip to satisfy uq_parent_child(childCustomerId, parentUserId)
    const newParentChildLinks = await db.insert(parentChildLinks).values(
        Array.from({ length: N }, (_, i) => ({
            parentUserId: newUsers[i].id,
            childCustomerId: newCustomers[i].id,
            relation: "parent",
        })),
    ).returning({ id: parentChildLinks.id });
    console.log(`parent_child_links: +${newParentChildLinks.length}`);

    const newBarcodes = await db.insert(barcodes).values(
        Array.from({ length: N }, (_, i) => ({
            barcode: `${TAG}-BC-${pad(i, 8)}`,
            productVariantId: newProductVariants[i].id,
        })),
    ).returning({ id: barcodes.id });
    console.log(`barcodes: +${newBarcodes.length}`);

    const newProductBarcodes = await db.insert(productBarcodes).values(
        Array.from({ length: N }, (_, i) => ({
            productId: pick(newShopProducts, i).id,
            barcode: `${TAG}-PB-${pad(i, 8)}`,
            label: `Seed label ${i}`,
        })),
    ).returning({ id: productBarcodes.id });
    console.log(`product_barcodes: +${newProductBarcodes.length}`);

    const newStockLevels = await db.insert(stockLevels).values(
        Array.from({ length: N }, (_, i) => ({
            productVariantId: newProductVariants[i].id,
            quantity: randInt(0, 300),
            lowStockThreshold: 10,
        })),
    ).returning({ id: stockLevels.id });
    console.log(`stock_levels: +${newStockLevels.length}`);

    const today = new Date().toISOString().slice(0, 10);
    const newFifoLots = await db.insert(fifoLots).values(
        Array.from({ length: N }, (_, i) => ({
            id: `${TAG}-LOT-${pad(i)}`,
            productId: pick(newShopProducts, i).id,
            shopId: pick(newShops, i).id,
            date: today,
            qtyRemaining: String(randInt(0, 100)),
            costPerUnit: randMoney(5, 50),
        })),
    ).returning({ id: fifoLots.id });
    console.log(`fifo_lots: +${newFifoLots.length}`);

    const MOVEMENT_TYPES = ["receive", "sale", "adjustment", "internal_use", "void", "exchange"] as const;
    const newShopMovements = await db.insert(shopMovements).values(
        Array.from({ length: N }, (_, i) => ({
            date: today,
            productId: pick(newShopProducts, i).id,
            productName: `Seed movement product ${i}`,
            shopId: pick(newShops, i).id,
            type: pick(MOVEMENT_TYPES as unknown as string[], i) as (typeof MOVEMENT_TYPES)[number],
            quantity: randInt(1, 20),
            stockBefore: 100,
            stockAfter: 90,
            createdBy: pick(newUsers, i).id,
        })),
    ).returning({ id: shopMovements.id });
    console.log(`shop_movements: +${newShopMovements.length}`);

    const newProductOrderHistory = await db.insert(productOrderHistory).values(
        Array.from({ length: N }, (_, i) => ({
            shopId: pick(newShops, i).id,
            version: 1,
            sortMap: {},
            changedBy: pick(newUsers, i).id,
            source: "seed",
        })),
    ).returning({ id: productOrderHistory.id });
    console.log(`product_order_history: +${newProductOrderHistory.length}`);

    const placeholderPng = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
    );
    const newCustomerDisplayImages = await db.insert(customerDisplayImages).values(
        Array.from({ length: N }, (_, i) => ({
            data: placeholderPng,
            contentType: "image/png",
            filename: `${TAG}-img-${pad(i)}.png`,
            sizeBytes: placeholderPng.length,
            sortOrder: i,
            uploadedBy: pick(newUsers, i).id,
        })),
    ).returning({ id: customerDisplayImages.id });
    console.log(`customer_display_images: +${newCustomerDisplayImages.length}`);

    const newIdentityMappings = await db.insert(identityMappings).values(
        Array.from({ length: N }, (_, i) => ({
            entityType: "customer",
            entityId: newCustomers[i].id,
            oldExternalId: `${TAG}-OLD-${pad(i)}`,
            newExternalId: `${TAG}-NEW-${pad(i)}`,
            reason: "seed",
            changedBy: pick(newUsers, i).id,
        })),
    ).returning({ id: identityMappings.id });
    console.log(`identity_mappings: +${newIdentityMappings.length}`);

    // ── Tier 4 ──────────────────────────────────────────────────────────
    const newMenuOptions = await db.insert(menuOptions).values(
        Array.from({ length: N }, (_, i) => ({
            optionGroupId: pick(newMenuOptionGroups, i).id,
            name: `Seed Option ${i}`,
            priceDelta: randMoney(0, 20),
            sortOrder: i,
        })),
    ).returning({ id: menuOptions.id });
    console.log(`menu_options: +${newMenuOptions.length}`);

    const newWalletTransactions = await db.insert(walletTransactions).values(
        Array.from({ length: N }, (_, i) => {
            const amount = randMoney(50, 1000);
            return {
                walletId: newWallets[i].id,
                transactionType: "TOPUP" as const,
                amount,
                balanceBefore: "0",
                balanceAfter: amount,
                referenceType: "seed",
                description: `Seed top-up ${i}`,
                createdBy: pick(newUsers, i).id,
            };
        }),
    ).returning({ id: walletTransactions.id });
    console.log(`wallet_transactions: +${newWalletTransactions.length}`);

    // Sync wallet.balance to match the single seeded TOPUP tx per wallet.
    for (let i = 0; i < N; i++) {
        const tx = newWalletTransactions[i];
        await pgClient`
            UPDATE wallets SET balance = wt.balance_after
            FROM wallet_transactions wt
            WHERE wallets.id = ${newWallets[i].id} AND wt.id = ${tx.id}
        `;
    }
    console.log(`wallets: balances synced to seeded top-up`);

    const TXN_TYPES = ["SALE", "RETURN", "ADJUSTMENT", "INTERNAL_ISSUE", "INITIAL"] as const;
    const newInventoryTransactions = await db.insert(inventoryTransactions).values(
        Array.from({ length: N }, (_, i) => ({
            transactionType: pick(TXN_TYPES as unknown as string[], i) as (typeof TXN_TYPES)[number],
            productVariantId: newProductVariants[i].id,
            quantityChange: randInt(-20, 20),
            referenceType: "seed",
            createdBy: pick(newUsers, i).id,
        })),
    ).returning({ id: inventoryTransactions.id });
    console.log(`inventory_transactions: +${newInventoryTransactions.length}`);

    const newStockMovements = await db.insert(stockMovements).values(
        Array.from({ length: N }, (_, i) => ({
            productVariantId: newProductVariants[i].id,
            quantityBefore: 100,
            quantityChange: -10,
            quantityAfter: 90,
            movementType: pick(TXN_TYPES as unknown as string[], i) as (typeof TXN_TYPES)[number],
            createdBy: pick(newUsers, i).id,
        })),
    ).returning({ id: stockMovements.id });
    console.log(`stock_movements: +${newStockMovements.length}`);

    const BUDGET_TX_TYPES = ["ALLOCATION", "DEDUCTION", "ADJUSTMENT"] as const;
    const newBudgetTransactions = await db.insert(budgetTransactions).values(
        Array.from({ length: N }, (_, i) => ({
            departmentId: newDepartments[i].id,
            amount: randMoney(100, 5000),
            transactionType: pick(BUDGET_TX_TYPES as unknown as string[], i) as (typeof BUDGET_TX_TYPES)[number],
            balanceBefore: randMoney(1000, 10000),
            balanceAfter: randMoney(1000, 10000),
            createdBy: pick(newUsers, i).id,
        })),
    ).returning({ id: budgetTransactions.id });
    console.log(`budget_transactions: +${newBudgetTransactions.length}`);

    const APPROVAL_TYPES = ["BUDGET_OVERRIDE", "DISCOUNT", "RETURN", "VOID", "PRICE_OVERRIDE"] as const;
    const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
    const newApprovalRequests = await db.insert(approvalRequests).values(
        Array.from({ length: N }, (_, i) => ({
            requestType: pick(APPROVAL_TYPES as unknown as string[], i) as (typeof APPROVAL_TYPES)[number],
            requestedBy: pick(newUsers, i).id,
            status: pick(APPROVAL_STATUSES as unknown as string[], i) as (typeof APPROVAL_STATUSES)[number],
            amount: randMoney(10, 500),
            reason: `Seed approval request ${i}`,
        })),
    ).returning({ id: approvalRequests.id });
    console.log(`approval_requests: +${newApprovalRequests.length}`);

    const newPaymentIntents = await db.insert(paymentIntents).values(
        Array.from({ length: N }, (_, i) => ({
            refCode: `${TAG}-PI-${pad(i)}`,
            walletId: newWallets[i].id,
            amount: randMoney(50, 1000),
            status: "confirmed" as const,
            paymentMethod: "qr_promptpay",
            createdBy: pick(newUsers, i).id,
        })),
    ).returning({ id: paymentIntents.id });
    console.log(`payment_intents: +${newPaymentIntents.length}`);

    const PAYMENT_METHODS = ["CASH", "CREDIT_CARD", "DEBIT_CARD", "WALLET", "QR_PROMPTPAY"] as const;
    const newReceipts = await db.insert(receipts).values(
        Array.from({ length: N }, (_, i) => {
            const subtotal = randMoney(20, 500);
            return {
                receiptNumber: `${TAG}-RCPT-${pad(i)}`,
                transactionMode: "SALE" as const,
                customerTypeId: 1,
                customerId: newCustomers[i].id,
                payerUserId: pick(newUsers, i).id,
                shopId: pick(newShops, i).id,
                subtotal,
                discount: "0",
                tax: "0",
                total: subtotal,
                paymentMethod: pick(PAYMENT_METHODS as unknown as string[], i) as (typeof PAYMENT_METHODS)[number],
                status: "ACTIVE" as const,
                createdBy: pick(newUsers, i).id,
            };
        }),
    ).returning({ id: receipts.id, receiptNumber: receipts.receiptNumber });
    console.log(`receipts: +${newReceipts.length}`);

    const newStockPeriodCloses = await db.insert(stockPeriodCloses).values(
        Array.from({ length: N }, (_, i) => ({
            shopId: pick(newShops, i).id,
            periodYear: new Date().getFullYear(),
            periodMonth: (i % 12) + 1,
            status: "draft",
            closedBy: pick(newUsers, i).id,
        })),
    ).returning({ id: stockPeriodCloses.id });
    console.log(`stock_period_closes: +${newStockPeriodCloses.length}`);

    // ── Tier 5 ──────────────────────────────────────────────────────────
    const newReceiptItems = await db.insert(receiptItems).values(
        Array.from({ length: N }, (_, i) => ({
            receiptId: newReceipts[i].id,
            productVariantId: newShopProducts[i].id,
            quantity: randInt(1, 5),
            unitPrice: randMoney(10, 100),
            discount: "0",
            lineTotal: randMoney(10, 500),
        })),
    ).returning({ id: receiptItems.id });
    console.log(`receipt_items: +${newReceiptItems.length}`);

    const REFUND_TYPES = ["PRODUCT", "WALLET", "CASH"] as const;
    const CREDIT_NOTE_STATUSES = ["PENDING", "APPROVED", "REJECTED", "COMPLETED"] as const;
    const newCreditNotes = await db.insert(creditNotes).values(
        Array.from({ length: N }, (_, i) => ({
            creditNoteNumber: `${TAG}-CN-${pad(i)}`,
            originalReceiptId: newReceipts[i].id,
            totalCreditAmount: randMoney(10, 200),
            refundType: pick(REFUND_TYPES as unknown as string[], i) as (typeof REFUND_TYPES)[number],
            status: pick(CREDIT_NOTE_STATUSES as unknown as string[], i) as (typeof CREDIT_NOTE_STATUSES)[number],
            createdBy: pick(newUsers, i).id,
        })),
    ).returning({ id: creditNotes.id });
    console.log(`credit_notes: +${newCreditNotes.length}`);

    const RETURN_STATUSES = ["pending", "approved", "rejected"] as const;
    const newReturnRequests = await db.insert(returnRequests).values(
        Array.from({ length: N }, (_, i) => ({
            receiptId: newReceipts[i].receiptNumber,
            productCode: `${TAG}-SP-${pad(i)}`,
            productName: `Seed return product ${i}`,
            quantity: randInt(1, 5),
            returnQuantity: 1,
            price: randMoney(10, 100),
            reason: "Seed return",
            status: pick(RETURN_STATUSES as unknown as string[], i) as (typeof RETURN_STATUSES)[number],
        })),
    ).returning({ id: returnRequests.id });
    console.log(`return_requests: +${newReturnRequests.length}`);

    const newStockPeriodCloseItems = await db.insert(stockPeriodCloseItems).values(
        Array.from({ length: N }, (_, i) => ({
            closeId: newStockPeriodCloses[i].id,
            productId: newShopProducts[i].id,
            systemQty: randInt(0, 200),
            physicalQty: randInt(0, 200),
        })),
    ).returning({ id: stockPeriodCloseItems.id });
    console.log(`stock_period_close_items: +${newStockPeriodCloseItems.length}`);

    console.log(`\nDone. Run tag: ${TAG} (grep this prefix to find/clean up seeded rows later).`);
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pgClient.end({ timeout: 5 });
    });
