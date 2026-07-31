# ISB System Updates — 2 Weeks Summary (July 17-31, 2026)

## 🎯 Major Features & Improvements

### 1. **Barcode Management & Printing** 
**Commits:** `3743c31`, `3b3309a`, `bdcc858`, `e815322`, `51a4367`, `fb81473`, `30da1db`, `1ec6393`, `f3828b4`

✅ **Fixes:**
- Fixed barcode layout warping at 1920x1080 resolution
- Fixed sticker sheet margins (reduced to 10mm sides, 0mm top/bottom)
- Fixed "popup blocked" error during barcode export
- Made "X barcodes +" badge clickable to add all barcodes
- Fixed race condition when adding multiple barcodes (now adds all, not just 1)
- Skip duplicate barcodes when clicking "Add all"
- Fixed React key warnings in barcode list
- Primary barcode field shows productCode as fallback when empty

📍 **Access:** [Inventory → Export Barcodes](http://localhost:5173/inventory)

---

### 2. **Transaction History Display Enhancement**
**Commits:** `1f03414`

✅ **What's new:**
- Changed from time-only display to **DD/MM/YYYY HH:mm** format
- Applied to both dashboard recent activity and transaction history pages
- Consistent date/time formatting across all transaction views

📍 **Access:** 
- [Parent Dashboard - Recent Activity](http://localhost:5173/parent/dashboard)
- [Transaction History](http://localhost:5173/parent/transactions/:customerId)

---

### 3. **EDC Payment Integration for Top-ups**
**Commits:** `ca925c2`, `b0355b1`, `2e2a4ec`, `f29294f`

✅ **Features:**
- Added EDC payment method option to Topup modal (matching POS sales page pattern)
- QR Code + Credit Card payment options for EDC
- Integration with EDC terminal via `edc_approval_code`, `edc_terminal_ref`, `edc_masked_card`
- 3% EDC card fee calculation and reporting
- Top-up amounts: 1-50,000 baht

📍 **Access:** 
- [Cashier Top-up Modal](http://localhost:5173/admin)
- [Kiosk Top-up](http://localhost:5173)
- [Sales Summary Report - Card Fee Column](http://localhost:5173/canteen/reports)

---

### 4. **Top-up Reporting & Description**
**Commits:** `3bfad42`, `b0355b1`, `748561f`, `ac90b61`, `086c204`

✅ **Enhancements:**
- Top-up description sanitization and display logic
- External ID fields added to top-up reporting
- New shop top-up report with detailed transaction info
- Top-up channel information (Cash/EDC/QR)
- "Topped By" fields tracking who initiated the top-up

📍 **Access:** 
- [Shop Top-up Reports](http://localhost:5173/canteen/reports)
- [Admin Top-up Reporting](http://localhost:5173/admin/reports)

---

### 5. **Notification & Email Handling**
**Commits:** `e2e347a`, `995818`, `d8ac527`, `8198e4e`

✅ **Updates:**
- Enhanced notification email handling and localization
- Low-balance alert email improvements
- Email notification for technician password changes
- Improved email content readability

📍 **Access:** [Admin Settings → Notifications](http://localhost:5173/admin/settings)

---

### 6. **UI/UX Improvements**
**Commits:** `5194885`, `3532b7a`, `079c11f`

✅ **Enhancements:**
- Optimized modal layouts for 1920x1080 screens
- Responsive modal sizing to reduce scroll requirements
- Cashier top-up modal with receipt printing
- Kiosk splash screen with BootSplashVideo component

📍 **Access:** 
- [Kiosk Interface](http://localhost:5173)
- [Cashier Interface](http://localhost:5173/admin)

---

### 7. **Reports & Analytics**
**Commits:** `2e2a4ec`, `b0355b1`, `02a180d`, `748561f`, `ca7ce0f`

✅ **New/Updated Reports:**
- Sales Summary Report with 3% EDC card fee breakdown
- Daily Sales Report enhancements
- Kiosk transaction reporting with additional fields
- Balance report with ISB_ID, owner name, previous balance
- Store top-up report with channel information

📍 **Access:** [Canteen/Admin Reports Section](http://localhost:5173/canteen/reports) or [Admin Reports](http://localhost:5173/admin/reports)

---

## 📊 Statistics

- **Total Commits:** 48 commits in 2 weeks
- **Files Modified:** ~15 major files (frontend + backend)
- **Features Added:** 5 major features
- **Bugs Fixed:** 9+ bugs
- **Reports Enhanced:** 4+ reports improved

---

## 🔧 Technical Details

### Backend Services Updated
- `TopupController` & `topup_service.ts` — EDC payment handling
- `report_service.ts` — Report calculations with EDC fees
- `NotificationService` — Email handling improvements

### Frontend Components Updated
- `PrintBarcodeDialog.tsx` — Barcode batching & printing
- `FamilyDashboard.tsx` — Date/time display
- `TransactionHistory.tsx` — Date/time formatting
- `CashierTopupModal.tsx` — EDC payment integration
- Various report components

---

## 📝 Notes

- All changes maintain backward compatibility
- Date formatting uses centralized `fmtDateTime()` utility (DD/MM/YYYY HH:mm, Bangkok timezone)
- EDC integration follows existing QR payment patterns
- All UI changes tested at 1920x1080 resolution

---

**Last Updated:** July 31, 2026  
**Branch:** `charp` → `development`
