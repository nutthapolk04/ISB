# BOOKSTORE POS SYSTEM - TECHNICAL SPECIFICATION

> **Implementation note:** Production backend is `backend-bun/` (Bun + Elysia + Drizzle). This document is the **original requirement baseline** — references to Python/FastAPI/Alembic describe the spec intent, not the current stack.

## PROJECT OVERVIEW

You are a senior software architect and full-stack engineer tasked with designing and implementing a production-grade BOOKSTORE POS SYSTEM. This system must be designed as a scalable POS solution suitable for schools and educational institutions.

**All requirements must be followed exactly and implemented to production standards.**

---

## TECHNOLOGY STACK

### Backend
- **Framework**: Python Django or FastAPI
- **Language**: Python 3.11+
- **Architecture**: REST API with modular design

### Frontend
- **Framework**: React or Next.js
- **Interface**: POS-optimized UI with responsive design
- **State Management**: React Query / TanStack Query
- **UI Components**: shadcn/ui or similar component library

### Database
- **Primary Database**: PostgreSQL 15+
- **Migration Tool**: Alembic (FastAPI) or Django Migrations

### Architecture Principles
- RESTful API design
- Modular, maintainable code structure
- Separation of concerns (business logic, data access, presentation)

---

## PERFORMANCE REQUIREMENTS

### System Capacity
- **Multi-terminal Support**: Must support 10+ concurrent POS terminals
- **Product Capacity**: Must handle thousands of products efficiently
- **Concurrent Users**: Must support multiple simultaneous users without performance degradation

### Speed Requirements
- **POS Loading**: Fast page load times (<2 seconds)
- **Barcode Scanning**: Instant response on barcode scan
- **Search Performance**: Sub-second search results for products (name, SKU, barcode)

### Offline Capabilities
- **Offline Mode**: POS must work offline and sync when reconnected
- **Local Storage**: Store transactions locally during offline periods
- **Sync Mechanism**: Automatic synchronization when online connection is restored

---

## SECURITY REQUIREMENTS

### Access Control
- **Authentication**: Secure user authentication system
- **Authorization**: Role-based access control (RBAC)
- **User Roles**: Admin, Manager, Cashier, Staff

### Data Security
- **Price Privacy**: Cashiers cannot view cost prices (only retail prices)
- **Admin Access**: Admins have full visibility including cost prices
- **Audit Trail**: All critical operations must be logged

---

## SYSTEM MODULES

The system consists of 10 core modules:

1. Product Management
2. Barcode System
3. Pricing System
4. POS Engine
5. Inventory Engine
6. Return & Exchange Engine
7. Wallet System
8. Reporting Engine
9. Budget Control Engine
10. Audit Log Engine

---

## MODULE 1: PRODUCT & BARCODE MANAGEMENT

### Product Structure
- Products can have multiple **variants**
- Each product belongs to a **category**

### Product Variants
Support variant types including:
- **Color**: Red, Blue, Green, etc.
- **Size**: S, M, L, XL, etc.
- **Other custom attributes** as needed

### Variant Requirements
Each variant must have:
- **Unique barcode** (generated or manual)
- **Individual stock quantity**
- **Low stock threshold** for alerts
- **Pricing information**

### Barcode System Features
- **Barcode Generation**: Automatic barcode generation (Code128, EAN13, etc.)
- **Label Printing**: Generate and print barcode labels
- **Barcode Scanning**: Fast barcode lookup in POS

### Reporting
- **Sales by Variant**: Track sales performance per variant
- **Stock by Variant**: View inventory levels per variant

### Required Tables
```
Products
├── id (PK)
├── name
├── description
├── category_id (FK)
├── brand
├── is_active
├── created_at
└── updated_at

ProductVariants
├── id (PK)
├── product_id (FK)
├── sku
├── variant_name (e.g., "Red - M")
├── color
├── size
├── barcode (unique)
├── cost_price
├── retail_price
├── is_active
├── created_at
└── updated_at

Barcodes
├── id (PK)
├── barcode (unique, indexed)
├── product_variant_id (FK)
├── created_at
└── updated_at

StockLevels
├── id (PK)
├── product_variant_id (FK)
├── quantity
├── low_stock_threshold
├── location
├── updated_at
└── updated_by
```

---

## MODULE 2: PRICING SYSTEM

### Price Levels
Each product variant has:
- **Cost Price**: Purchase/internal cost
- **Retail Price**: Public selling price

### Customer Types
- **Public**: Regular customers
- **Internal Staff**: School employees/authorized personnel

### Transaction Modes

#### Sales Mode
- Uses **Retail Price**
- For public customers
- Standard checkout flow

#### Internal Issue Mode
- Uses **Cost Price** automatically
- For internal staff only
- Requires authorization
- Deducts from department budget (if applicable)

### Security Rules
- **Cashier Role**: Cannot view cost prices
- **Admin Role**: Can view both cost and retail prices
- **Price Changes**: Logged in audit trail

### Required Tables
```
PriceLevels
├── id (PK)
├── product_variant_id (FK)
├── price_type (enum: 'cost', 'retail')
├── amount
├── effective_from
├── effective_to
├── created_at
└── updated_by

CustomerTypes
├── id (PK)
├── type_name (enum: 'public', 'internal')
├── description
├── default_price_level
└── created_at
```

---

## MODULE 3: POS ENGINE

### Performance Requirements
- **Fast Loading**: POS interface must load in under 2 seconds
- **Continuous Scanning**: Support rapid, continuous barcode scanning
- **Instant Search**: Sub-second product search

### Search Capabilities
Support search by:
- **Product Name**: Fuzzy/partial matching
- **SKU**: Exact match
- **Barcode**: Exact match

### UI/UX Requirements

#### Input Methods
- **Keyboard Hotkeys**: Fast navigation and actions
- **Touch Screen**: Optimized for touch input
- **Quick Buttons**: Frequently used functions
- **Barcode Scanner**: USB/Bluetooth scanner support

#### Interface Features
- Display stock availability in real-time
- Show product images
- Quick discount/promotion application
- Multi-item selection
- Cart management

### Multi-Terminal Support
- **Concurrent Terminals**: Support 10+ POS terminals simultaneously
- **Session Management**: Independent sessions per terminal
- **Conflict Resolution**: Handle concurrent stock updates

### Offline Mode
- **Local Queue**: Store transactions locally when offline
- **Auto-Sync**: Sync transactions when connection restored
- **Conflict Handling**: Detect and resolve sync conflicts
- **Status Indicator**: Show online/offline status clearly

---

## MODULE 4: INVENTORY ENGINE

### Stock Movement Rules

#### Sales Transaction
- **Action**: Deduct stock quantity
- **Trigger**: Receipt finalized
- **Reversal**: Restore on void

#### Internal Issue
- **Action**: Deduct stock quantity
- **Trigger**: Internal issue document created
- **Budget Impact**: Deduct from department budget

#### Return
- **Action**: Increase stock quantity
- **Trigger**: Return processed
- **Document**: Generate credit note

#### Exchange
- **Action**: Adjust stock for both returned and new items
- **Trigger**: Exchange processed
- **Price Difference**: Calculate automatically

#### Void/Cancel
- **Action**: Restore original stock quantity
- **Trigger**: Transaction voided
- **Audit**: Log cancellation reason

### POS Integration
- Show **real-time stock availability** on POS screen
- Block sale if insufficient stock
- Alert on low stock items

### Reporting
- **Stock Movement Report**: All stock changes with dates
- **Stock Valuation**: Current inventory value
- **Excel Export**: Export reports to Excel format

### Required Tables
```
InventoryTransactions
├── id (PK)
├── transaction_type (enum: 'sale', 'return', 'adjustment', 'internal_issue')
├── product_variant_id (FK)
├── quantity_change (can be negative)
├── reference_type (e.g., 'receipt', 'return', 'adjustment')
├── reference_id
├── reason
├── created_at
└── created_by

StockMovements
├── id (PK)
├── product_variant_id (FK)
├── quantity_before
├── quantity_change
├── quantity_after
├── movement_type
├── reference_document
├── notes
├── created_at
└── created_by
```

---

## MODULE 5: RECEIPT & TRANSACTION CONTROL

### Receipt Immutability
- **Receipts cannot be edited** after creation
- **Receipts are immutable** for audit compliance
- Changes require new documents (credit notes, refunds)

### Receipt Features
- **Receipt Search**: Search by receipt number, date, customer
- **Receipt Reprint**: Allow reprint of original receipt
- **Receipt Details**: View full transaction details

### Return & Exchange Documents

#### Credit Note
- Generated for product returns
- References original receipt
- Shows returned items and amounts

#### Refund Slip
- Generated for cash/wallet refunds
- Links to credit note
- Shows refund method

### Audit Trail
Track all transaction events:
- **Create**: Receipt creation
- **Return**: Items returned
- **Exchange**: Items exchanged
- **Cancel/Void**: Transaction cancellation
- **Reprint**: Receipt reprinted

### Audit Log Export
- Export audit logs to CSV/Excel
- Filter by date range, user, transaction type
- Include all transaction metadata

### Required Tables
```
Receipts
├── id (PK)
├── receipt_number (unique, indexed)
├── transaction_date
├── transaction_mode (enum: 'sale', 'internal_issue')
├── customer_type_id (FK)
├── customer_id (FK, nullable)
├── subtotal
├── discount
├── tax
├── total
├── payment_method_id (FK)
├── status (enum: 'active', 'voided')
├── terminal_id
├── created_at
├── created_by
└── voided_at

ReceiptItems
├── id (PK)
├── receipt_id (FK)
├── product_variant_id (FK)
├── quantity
├── unit_price
├── discount
├── line_total
├── created_at
└── updated_at

CreditNotes
├── id (PK)
├── credit_note_number (unique)
├── original_receipt_id (FK)
├── credit_date
├── total_credit_amount
├── refund_type (enum: 'product', 'wallet', 'cash')
├── status
├── created_at
└── created_by

AuditLogs
├── id (PK)
├── entity_type (e.g., 'receipt', 'return', 'exchange')
├── entity_id
├── action (enum: 'create', 'return', 'exchange', 'cancel', 'reprint')
├── user_id (FK)
├── changes_json (JSONB)
├── ip_address
├── created_at
└── metadata (JSONB)
```

---

## MODULE 6: RETURN & EXCHANGE ENGINE

### Return Features

#### Partial Return
- Allow return of some items from a receipt
- Calculate refund amount proportionally

#### Partial Exchange
- Allow exchange of some items
- Calculate price difference automatically

### Refund Types

#### Product Refund
- Return item for another product
- No money back
- Generate exchange document

#### Wallet Refund
- Credit customer wallet
- No cash handling
- Audit trail

#### Cash Refund
- Return cash to customer
- Requires manager approval
- Generate refund slip

### Return Process
1. Scan/enter original receipt
2. Select items to return
3. Enter return reason (mandatory)
4. Choose refund type
5. Process return
6. Generate credit note/refund document
7. Update inventory

### Return Reason Tracking
- **Defective Product**
- **Wrong Size/Color**
- **Customer Changed Mind**
- **Other** (with notes)

### Return Without Receipt
- Allow returns without receipt (admin approval)
- Issue store credit only
- Limit return amount
- Track for fraud prevention

### Reporting
- **Return Percentage**: Returns as % of sales
- **Return by Reason**: Breakdown by reason
- **Return by Product**: Identify problematic products

---

## MODULE 7: WALLET SYSTEM

### Wallet Features

#### Wallet Top-Up
- Add credit to customer wallet
- Accept cash/card payment
- Generate top-up receipt

#### Wallet Deduction
- Deduct from wallet during purchase
- Show balance before and after
- Real-time balance update

#### Wallet Refund
- Credit wallet for returns
- Track refund source

### Customer Wallet Profile
- **Customer Photo**: Upload and display customer photo
- **Card Display**: Visual wallet card in POS
- **Balance Display**: Show current balance prominently
- **Transaction History**: View wallet transaction log

### Wallet Rules

#### Insufficient Balance
- **Block Purchase**: Do not allow purchase if balance insufficient
- **Clear Warning**: Show balance and shortage amount

#### Department Accounts (Exception)
- Allow negative balance
- Track deficit
- Deduct from department budget
- Require department approval

### Accounting Separation
- **Wallet Revenue** ≠ **Sales Revenue**
- Wallet top-up is liability (customer credit)
- Only actual product sales count as revenue

### Reporting
- **Wallet Usage Report**: Total wallet payments
- **Wallet Top-Up Report**: Total top-ups by period
- **Outstanding Balance**: Total wallet liability
- **Wallet Transaction History**: Per customer

### Real-Time Balance
- Update balance instantly after transaction
- Show balance in POS during checkout
- Sync balance across terminals

### Required Tables
```
Wallets
├── id (PK)
├── customer_id (FK, unique)
├── balance
├── is_active
├── created_at
└── updated_at

WalletTransactions
├── id (PK)
├── wallet_id (FK)
├── transaction_type (enum: 'topup', 'deduction', 'refund', 'adjustment')
├── amount
├── balance_before
├── balance_after
├── reference_type (e.g., 'receipt', 'credit_note')
├── reference_id
├── description
├── created_at
└── created_by

Customers
├── id (PK)
├── customer_code (unique)
├── name
├── photo_url
├── customer_type_id (FK)
├── department_id (FK, nullable)
├── email
├── phone
├── is_active
├── created_at
└── updated_at
```

---

## MODULE 8: REPORTING ENGINE

### Daily Executive Report

This is the **main financial summary** for the day.

#### Report Components

**1. Gross Sales**
- Total sales before any deductions
- Sum of all receipt totals

**2. Product Refund**
- Total value of product returns
- Deducted from gross sales

**3. Wallet Refund**
- Refunds credited to wallet
- Separate from cash refunds

**4. Return Exchange Difference**
- Net difference from exchanges
- Can be positive or negative

**5. Net Sales**
```
Net Sales = Gross Sales - Product Refund - Wallet Refund ± Return Exchange Difference
```

#### Breakdown by Payment Method
Show totals for each:
- **Cash**
- **Credit Card**
- **Debit Card**
- **Wallet**
- **Bank Transfer**
- **Other**

#### Breakdown by Transaction Mode
Separate reporting for:
- **Sales**: Public customer sales
- **Internal Issue**: Staff/department issues

#### Include Cancelled Receipts
- Show count and total of voided receipts
- Separate section for audit purposes

### Report Format
- **Daily**: End-of-day report
- **Date Range**: Custom period reports
- **Export**: PDF and Excel formats

---

## MODULE 9: PRODUCT OUT REPORT

### Report Purpose
Track all products leaving inventory, regardless of reason.

### Product Out Categories

#### Sales
- Products sold to customers
- Revenue generating

#### Internal Issue
- Products issued to staff/departments
- Not revenue (uses cost price)

#### Return
- Products returned by customers
- Negative product out

#### Adjustment
- Inventory adjustments
- Damage, loss, corrections

### Report Columns
- Product Name
- Variant
- Barcode
- Category
- Quantity Out
- Value (at cost price)
- Transaction Type
- Date
- Reference Document

### Features
- **Date Filtering**: Select date range
- **Category Filtering**: Filter by transaction type
- **Excel Export**: Export full report
- **Summary Totals**: Total quantity and value per category

---

## MODULE 10: BUDGET CONTROL SYSTEM

### Department Budget Structure

Each department has:
- **Annual Budget**: Total budget for the year
- **Used Budget**: Amount spent to date
- **Remaining Budget**: Budget still available

### Budget Tracking

#### Internal Issue Impact
- Every internal issue deducts from department budget
- Deduction uses **cost price** of items
- Real-time budget update

#### Display Format
```
Department: Science Department
Annual Budget:     ฿100,000.00
Used Budget:       ฿35,000.00
Remaining Budget:  ฿65,000.00
```

### Real-Time Tracking
- Update budget immediately after internal issue
- Show remaining budget in POS
- Alert staff when nearing limit

### Required Tables
```
Departments
├── id (PK)
├── department_code (unique)
├── department_name
├── annual_budget
├── current_year
├── is_active
├── created_at
└── updated_at

BudgetTransactions
├── id (PK)
├── department_id (FK)
├── transaction_date
├── amount
├── transaction_type (enum: 'allocation', 'deduction', 'adjustment')
├── reference_type (e.g., 'internal_issue')
├── reference_id
├── description
├── balance_before
├── balance_after
├── created_at
└── created_by
```

---

## MODULE 11: BUDGET ALERT SYSTEM

### Alert Thresholds

#### Warning Alert
- Trigger when budget reaches configurable % (e.g., 80%)
- Show warning message in POS
- Notify department head

#### Critical Alert
- Trigger when budget exceeded
- Block further internal issues (unless approved)
- Send urgent notification

### Alert Configuration
- Set warning threshold percentage
- Set critical threshold (100% or custom)
- Configure notification recipients
- Enable/disable auto-blocking

### Notifications
- **In-App**: Show alert banner in POS
- **Email**: Send to department head and admins
- **Dashboard**: Display in admin dashboard

---

## MODULE 12: APPROVAL WORKFLOW

### Approval Triggers

Approval required when:
- **Budget Exceeded**: Internal issue request over department budget
- **Large Transaction**: Transaction over specified amount
- **Special Discount**: Discount over authorized limit
- **Return Without Receipt**: Return without original receipt

### Approval Process

#### 1. Request Creation
- User initiates transaction requiring approval
- System creates approval request
- Transaction placed on hold

#### 2. Approval Screen
- Manager/admin sees pending approvals
- View request details
- Approve or reject with reason

#### 3. Approval History
- Log all approval decisions
- Track approver, timestamp, reason
- Link to original transaction

### Required Tables
```
ApprovalRequests
├── id (PK)
├── request_type (enum: 'budget_override', 'discount', 'return')
├── requested_by (FK to Users)
├── request_date
├── status (enum: 'pending', 'approved', 'rejected')
├── amount
├── reason
├── reference_type
├── reference_id
├── approved_by (FK to Users, nullable)
├── approval_date (nullable)
├── approval_notes
├── created_at
└── updated_at
```

---

## DATABASE SCHEMA OVERVIEW

### Core Tables Summary

#### Product Management
- Products
- ProductVariants
- Categories
- Barcodes
- StockLevels

#### Transactions
- Receipts
- ReceiptItems
- CreditNotes
- RefundSlips

#### Inventory
- InventoryTransactions
- StockMovements

#### Customer & Wallet
- Customers
- Wallets
- WalletTransactions
- CustomerTypes

#### Pricing
- PriceLevels
- PaymentMethods

#### Budget & Department
- Departments
- BudgetTransactions

#### System
- Users
- Roles
- Permissions
- AuditLogs
- ApprovalRequests

---

## API SPECIFICATION OVERVIEW

### API Design Principles
- RESTful endpoints
- JSON request/response format
- JWT authentication
- Role-based authorization
- Consistent error handling
- API versioning (v1)

### Key API Endpoints

#### Products
```
GET    /api/v1/products
GET    /api/v1/products/:id
POST   /api/v1/products
PUT    /api/v1/products/:id
DELETE /api/v1/products/:id
GET    /api/v1/products/search?q={query}
GET    /api/v1/products/barcode/:barcode
```

#### POS
```
POST   /api/v1/pos/checkout
GET    /api/v1/pos/receipt/:id
POST   /api/v1/pos/void/:id
GET    /api/v1/pos/search?q={query}
```

#### Returns
```
POST   /api/v1/returns
GET    /api/v1/returns/:id
POST   /api/v1/returns/:id/approve
```

#### Wallet
```
GET    /api/v1/wallet/:customerId
POST   /api/v1/wallet/topup
POST   /api/v1/wallet/deduct
GET    /api/v1/wallet/:customerId/transactions
```

#### Reports
```
GET    /api/v1/reports/daily-executive?date={date}
GET    /api/v1/reports/product-out?from={date}&to={date}
GET    /api/v1/reports/budget-status/:departmentId
```

---

## FOLDER STRUCTURE

### Backend (FastAPI)
```
backend/
├── alembic/                 # Database migrations
├── app/
│   ├── __init__.py
│   ├── main.py             # FastAPI app entry point
│   ├── core/
│   │   ├── config.py       # Configuration
│   │   ├── security.py     # Auth & security
│   │   └── database.py     # DB connection
│   ├── models/             # SQLAlchemy models
│   │   ├── product.py
│   │   ├── receipt.py
│   │   ├── wallet.py
│   │   └── ...
│   ├── schemas/            # Pydantic schemas
│   │   ├── product.py
│   │   ├── receipt.py
│   │   └── ...
│   ├── api/                # API routes
│   │   ├── v1/
│   │   │   ├── products.py
│   │   │   ├── pos.py
│   │   │   ├── returns.py
│   │   │   ├── wallet.py
│   │   │   └── reports.py
│   │   └── deps.py         # Dependencies
│   ├── services/           # Business logic
│   │   ├── product_service.py
│   │   ├── pos_service.py
│   │   ├── inventory_service.py
│   │   ├── wallet_service.py
│   │   └── budget_service.py
│   └── utils/              # Utilities
│       ├── barcode.py
│       └── pdf.py
├── tests/
├── requirements.txt
└── .env
```

### Frontend (React)
```
frontend/
├── public/
├── src/
│   ├── main.tsx            # Entry point
│   ├── App.tsx             # Root component
│   ├── components/         # Shared components
│   │   ├── ui/             # shadcn components
│   │   ├── AppSidebar.tsx
│   │   ├── LanguageSwitcher.tsx
│   │   └── ...
│   ├── pages/              # Page components
│   │   ├── POS.tsx
│   │   ├── Inventory.tsx
│   │   ├── Returns.tsx
│   │   ├── Wallet.tsx
│   │   ├── Reports.tsx
│   │   └── ...
│   ├── hooks/              # Custom React hooks
│   │   ├── useProducts.ts
│   │   ├── useCart.ts
│   │   ├── useWallet.ts
│   │   └── ...
│   ├── lib/                # Utilities
│   │   ├── api.ts          # API client
│   │   ├── utils.ts
│   │   └── constants.ts
│   ├── types/              # TypeScript types
│   │   ├── product.ts
│   │   ├── receipt.ts
│   │   └── ...
│   ├── styles/             # Styles
│   │   └── globals.css
│   └── locales/            # i18n translations
│       ├── en.json
│       └── th.json
├── package.json
└── vite.config.ts
```

---

## IMPLEMENTATION PLAN

### Phase 1: MVP (Minimum Viable Product)

#### Objective
Launch a functional POS system with core features for daily operations.

#### Scope

**Week 1-2: Backend Foundation**
- Setup FastAPI project structure
- Configure PostgreSQL database
- Implement authentication & authorization
- Create base models (Products, Variants, Barcodes, Stock)
- Develop product management APIs

**Week 3-4: POS Core**
- Implement POS checkout flow
- Barcode scanning integration
- Receipt generation
- Basic inventory deduction
- Payment methods (cash, card)

**Week 5-6: Frontend POS**
- Setup React project
- Build POS interface
- Product search & selection
- Cart management
- Checkout process
- Receipt printing

**Week 7-8: Returns & Inventory**
- Return processing
- Credit note generation
- Inventory tracking
- Stock movement logging
- Basic reporting (sales, inventory)

#### MVP Features
✅ Product management with variants
✅ Barcode system
✅ POS checkout (sales mode)
✅ Basic inventory tracking
✅ Returns processing
✅ Receipt printing
✅ User authentication
✅ Basic reports

#### MVP Exclusions
❌ Wallet system
❌ Budget control
❌ Internal issue mode
❌ Approval workflow
❌ Advanced reporting
❌ Offline mode

---

### Phase 2: Advanced Features

#### Objective
Add wallet, budget control, and advanced features.

#### Scope

**Week 9-10: Wallet System**
- Customer wallet management
- Wallet top-up
- Wallet payments
- Wallet refunds
- Customer profiles with photos

**Week 11-12: Budget Control**
- Department management
- Budget allocation
- Internal issue mode
- Budget tracking
- Budget alerts

**Week 13-14: Advanced Features**
- Approval workflow
- Return without receipt
- Partial returns/exchanges
- Advanced reporting (executive, product out)
- Export functionality (Excel, PDF)

**Week 15-16: Optimization & Polish**
- Offline mode implementation
- Performance optimization
- Multi-terminal sync
- Security hardening
- User training materials

#### Phase 2 Features
✅ Wallet system
✅ Budget control
✅ Internal issue mode
✅ Approval workflow
✅ Advanced reporting
✅ Offline mode
✅ Department management
✅ Budget alerts

---

### Phase 3: Production Hardening

**Testing & QA**
- Unit tests (80%+ coverage)
- Integration tests
- End-to-end tests
- Performance testing
- Security audit

**Deployment**
- Docker containerization
- CI/CD pipeline
- Production deployment
- Monitoring & logging
- Backup strategy

**Documentation**
- API documentation (Swagger/OpenAPI)
- User manual
- Admin guide
- System architecture docs
- Deployment guide

---

## SAMPLE API CODE

### Product Search Endpoint (FastAPI)

```python
# app/api/v1/products.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional

from app.api import deps
from app.models.product import Product, ProductVariant
from app.schemas.product import ProductVariantResponse
from app.services.product_service import ProductService

router = APIRouter()

@router.get("/search", response_model=List[ProductVariantResponse])
async def search_products(
    q: str,
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(deps.get_db),
    current_user = Depends(deps.get_current_user)
):
    """
    Search products by name, SKU, or barcode.
    Fast search optimized for POS usage.
    """
    product_service = ProductService(db)

    # Search by barcode first (exact match)
    variant = product_service.get_by_barcode(q)
    if variant:
        return [variant]

    # Search by name or SKU (partial match)
    variants = product_service.search(
        query=q,
        skip=skip,
        limit=limit,
        include_stock=True
    )

    return variants
```

### POS Checkout Endpoint (FastAPI)

```python
# app/api/v1/pos.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.api import deps
from app.schemas.receipt import ReceiptCreate, ReceiptResponse
from app.services.pos_service import POSService
from app.services.inventory_service import InventoryService
from app.core.security import check_permission

router = APIRouter()

@router.post("/checkout", response_model=ReceiptResponse)
async def checkout(
    receipt_data: ReceiptCreate,
    db: Session = Depends(deps.get_db),
    current_user = Depends(deps.get_current_user)
):
    """
    Process POS checkout transaction.
    Creates receipt, deducts inventory, processes payment.
    """
    pos_service = POSService(db)
    inventory_service = InventoryService(db)

    # Validate stock availability
    for item in receipt_data.items:
        available = inventory_service.get_available_stock(item.product_variant_id)
        if available < item.quantity:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient stock for variant {item.product_variant_id}"
            )

    # Process transaction (atomic)
    try:
        receipt = pos_service.create_receipt(
            receipt_data=receipt_data,
            user_id=current_user.id
        )

        # Deduct inventory
        for item in receipt.items:
            inventory_service.deduct_stock(
                product_variant_id=item.product_variant_id,
                quantity=item.quantity,
                reference_type="receipt",
                reference_id=receipt.id
            )

        db.commit()
        return receipt

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
```

### Wallet Top-Up Endpoint (FastAPI)

```python
# app/api/v1/wallet.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from decimal import Decimal

from app.api import deps
from app.schemas.wallet import WalletTopUp, WalletResponse
from app.services.wallet_service import WalletService

router = APIRouter()

@router.post("/topup", response_model=WalletResponse)
async def topup_wallet(
    topup_data: WalletTopUp,
    db: Session = Depends(deps.get_db),
    current_user = Depends(deps.get_current_user)
):
    """
    Top-up customer wallet.
    Creates wallet transaction and updates balance.
    """
    wallet_service = WalletService(db)

    # Validate amount
    if topup_data.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")

    # Process top-up (atomic)
    try:
        wallet = wallet_service.topup(
            customer_id=topup_data.customer_id,
            amount=Decimal(str(topup_data.amount)),
            payment_method=topup_data.payment_method,
            user_id=current_user.id
        )

        db.commit()
        return wallet

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
```

---

## CRITICAL SUCCESS FACTORS

### Performance
- POS must be **fast and responsive**
- Barcode scanning must be **instant**
- Search must return results in **<1 second**
- Support **10+ concurrent terminals**

### Reliability
- **99.9% uptime** for POS operations
- **Zero data loss** on transactions
- **Automatic failover** for critical services
- **Offline mode** for network outages

### Security
- **Role-based access control** enforced
- **Audit trail** for all critical operations
- **Price visibility** controlled by role
- **Data encryption** in transit and at rest

### Scalability
- Handle **thousands of products**
- Support **hundreds of daily transactions**
- Scale to **multiple school locations**
- **Multi-tenant architecture** ready

### Usability
- **Intuitive POS interface**
- **Fast training** for new cashiers
- **Minimal clicks** to complete sale
- **Clear error messages**

---

## GLOSSARY

**POS**: Point of Sale - The system where sales transactions occur
**SKU**: Stock Keeping Unit - Unique product identifier
**Variant**: Different version of a product (e.g., different color/size)
**Receipt**: Document of sale transaction
**Credit Note**: Document for returned items
**Wallet**: Customer prepaid balance system
**Internal Issue**: Products issued to staff/departments (not a sale)
**Budget Control**: Tracking department spending against allocated budget
**RBAC**: Role-Based Access Control
**Audit Trail**: Log of all system actions for accountability

---

## CONTACT & SUPPORT

For questions about this specification or implementation guidance:
- Review this document thoroughly
- Check the implementation plan for sequencing
- Refer to the sample code for patterns
- Follow the folder structure for organization

**This specification must be followed exactly. All requirements are mandatory for production deployment.**

---

*Document Version: 1.0*
*Last Updated: 2026-02-24*
*Status: Active Specification*
