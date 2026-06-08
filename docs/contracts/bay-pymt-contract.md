# BAY (Krungsri) PYMT Integration — Data Contract

**Version:** 1.0  
**Date:** 2026-06-08  
**Status:** AUTHORITATIVE — downstream agents implement exactly what this document says.

This document is the single source of truth for the BAY payment integration via PYMT Gateway. All backend (T2–T7) and frontend (T3–T5) agents implement against this contract without negotiation at runtime.

---

## A. Environment Variables (Backend)

Add to `backend/.env` and `backend/app/core/config.py` `Settings` class.

| Variable | Type | Description |
|---|---|---|
| `PYMT_BASE_URL` | `str` | PYMT gateway base URL, e.g. `http://localhost:9200` for local dev. No trailing slash. |
| `PYMT_MERCHANT_TOKEN` | `str` | Base64-encoded `username:password:merchantCode` string. Used verbatim as the value of the `Authorization: Basic {token}` header. Never decoded by the app — passed through as-is. |
| `PYMT_MERCHANT_CODE` | `str` | Merchant code string (e.g. `ISBBKK`). Used for logging and generating `ref1`/`ref2` values only. Not sent to PYMT directly. |
| `BAY_CALLBACK_SECRET` | `str` | **Not applicable for this prototype.** The PYMT guide specifies no shared secret or HMAC header on the callback POST. Callbacks are verified by IP allowlist at infrastructure level only. Leave unset in development. See open questions. |

Config addition in `app/core/config.py` (inside the `Settings` class):

```python
# BAY / PYMT Gateway
PYMT_BASE_URL: str = "http://localhost:9200"
PYMT_MERCHANT_TOKEN: str = ""      # Base64 username:password:merchantCode
PYMT_MERCHANT_CODE: str = ""       # for logging / ref generation
```

---

## B. PYMT Request / Response Shapes

### B.1 QR Payment

**Request**
```
POST {PYMT_BASE_URL}/api/v1/bay/qr
Authorization: Basic {PYMT_MERCHANT_TOKEN}
x-config-app: bay.qrPayment
Content-Type: application/json
```

Request body:

| Field | Type | Required | Constraint |
|---|---|---|---|
| `amount` | `number` | Yes | THB, positive |
| `ref1` | `string` | Yes | Max 20 chars, alphanumeric only (`A-Za-z0-9`). Use `ref_code` stripped to 20 chars alphanumeric. |
| `ref2` | `string` | No | Max 20 chars, alphanumeric only. Use wallet_id or customer code. |
| `channel` | `number` | Yes | `2` = PromptPay (default for ISB). See channel table below. |
| `subMerchantCode` | `string` | No | Defaults to `"default"` |
| `expiredMinutes` | `number` | No | Default `10`. Allowed: 10, 30, 360, 1440. |

QR channel codes:

| Value | Payment method |
|---|---|
| `1` | Alipay |
| `2` | PromptPay (Thai QR Tag 30) — **ISB default** |
| `3` | WeChat Pay |
| `4` | VISA QR |
| `5` | MasterCard QR |
| `20` | Unified QR (PromptPay + VISA + MC combined) |

**Success Response** (HTTP 200):

```json
{
  "status": "success",
  "data": {
    "txnNo": "OKTBAY<merchant><seq>",
    "qrcodeContent": "00020101021230560016A000000677010112..."
  }
}
```

| Field | Description |
|---|---|
| `txnNo` | PYMT internal transaction number. Store on `PaymentIntent.txn_no`. Use for inquiry and callback matching. |
| `qrcodeContent` | EMVCo QR string. Feed to a QR image library for display. |

**Error Response** (non-200 or `status != "success"`):

```json
{
  "status": "error",
  "message": "human-readable error"
}
```

---

### B.2 EASYPay (Credit Card)

**Request**
```
POST {PYMT_BASE_URL}/api/v1/bay/easypay
Authorization: Basic {PYMT_MERCHANT_TOKEN}
x-config-app: bay.easypay
Content-Type: application/json
```

Request body:

| Field | Type | Required | Constraint |
|---|---|---|---|
| `amount` | `number` | Yes | THB, positive |
| `orderRef` | `string` | Yes | Max 35 chars. Use `ref_code` directly — it fits within 35 chars and is already unique. This is the reconciliation key across the entire flow. |
| `successUrl` | `string` | Yes | Frontend success page, e.g. `{FRONTEND_BASE_URL}/payment/bay/success?ref={ref_code}` |
| `failUrl` | `string` | Yes | Frontend fail page, e.g. `{FRONTEND_BASE_URL}/payment/bay/fail?ref={ref_code}` |
| `cancelUrl` | `string` | Yes | Frontend cancel page, e.g. `{FRONTEND_BASE_URL}/payment/bay/cancel?ref={ref_code}` |
| `currCode` | `string` | No | `"764"` = THB (default) |
| `payType` | `string` | No | `"N"` = Normal/Sales (default). `"H"` = Authorize-only (not used in ISB). |
| `lang` | `string` | No | `"T"` = Thai, `"E"` = English. Default `"T"`. |
| `subMerchantCode` | `string` | No | Default `"default"` |

**Success Response** (HTTP 200):

```json
{
  "status": "success",
  "data": {
    "orderRef": "TOP20260608001",
    "paymentPageUrl": "https://uat.krungsrieasypay.com/BAY/eng/payment/payForm.jsp",
    "paymentFormParams": {
      "merchantId": "950200000",
      "orderRef": "TOP20260608001",
      "amount": "500.00",
      "currCode": "764",
      "successUrl": "https://app.isb.ac.th/payment/bay/success?ref=TOP20260608001",
      "failUrl": "https://app.isb.ac.th/payment/bay/fail?ref=TOP20260608001",
      "cancelUrl": "https://app.isb.ac.th/payment/bay/cancel?ref=TOP20260608001",
      "payType": "N",
      "payMethod": "CC",
      "lang": "T",
      "secureHash": "<hmac-sha256-signature>"
    }
  }
}
```

| Field | Description |
|---|---|
| `orderRef` | Echo of your `orderRef`. Store for reconciliation. |
| `paymentPageUrl` | Action URL for the HTML form POST to BAY. |
| `paymentFormParams` | Key-value map of hidden form inputs. **Do NOT modify any values** (especially `secureHash`) — BAY will reject the form. Pass all params verbatim to the frontend. |

---

## C. PYMT Callback Payloads

PYMT POSTs to our registered `callbackUrl` after BAY confirms payment.  
Registered callback URL: `{BACKEND_BASE_URL}/api/v1/bay/callback`

### C.1 QR Callback

```
POST /api/v1/bay/callback
Content-Type: application/json
```

```json
{
  "transactionNo": "OKTBAY<merchant><seq>",
  "reference1": "TOP20260608001",
  "reference2": "CUST001",
  "amount": 100.00,
  "status": "COMPLETED"
}
```

| Field | Type | Description |
|---|---|---|
| `transactionNo` | `string` | PYMT txnNo — matches `PaymentIntent.txn_no` |
| `reference1` | `string` | Our `ref1` from the QR request |
| `reference2` | `string` | Our `ref2` (optional, may be absent) |
| `amount` | `number` | Amount paid |
| `status` | `"COMPLETED" \| "FAILED"` | Payment result |

Lookup strategy: match on `transactionNo` → `PaymentIntent.txn_no`. Fall back to `reference1` → `PaymentIntent.ref_code` (alphanumeric, stripped form of ref_code).

### C.2 EASYPay Callback

```
POST /api/v1/bay/callback
Content-Type: application/json
```

```json
{
  "orderRef": "TOP20260608001",
  "amount": 500.00,
  "status": "COMPLETED"
}
```

| Field | Type | Description |
|---|---|---|
| `orderRef` | `string` | Our `orderRef` — matches `PaymentIntent.ref_code` directly |
| `amount` | `number` | Amount paid |
| `status` | `"COMPLETED" \| "FAILED"` | Payment result |

Lookup strategy: match `orderRef` → `PaymentIntent.ref_code` directly.

### C.3 Callback Verification

**For this prototype:** No shared secret header or HMAC is specified in the PYMT merchant guide. The guide only says to return HTTP 200. There is no `X-PYMT-Signature` or equivalent header documented.

**Verification approach for prototype:**
- No cryptographic verification.
- Rely on network-level protection (PYMT's IP is the only source; infrastructure firewall is out of scope for prototype).
- Idempotency check (see section F) prevents re-crediting on replay.

**Flag for production:** Before going live, confirm with the PYMT team whether a callback verification token/HMAC is available and add it as `BAY_CALLBACK_SECRET`.

---

## D. Updated `TopupIntentResponse` Schema

### D.1 Python (Pydantic) — `backend/app/schemas/wallet.py`

Current schema plus new fields:

```python
class TopupIntentResponse(BaseModel):
    # --- existing fields ---
    ref_code: str
    wallet_id: int
    amount: float
    qr_payload: str                              # empty string "" for BAY QR (qrcodeContent goes here); unchanged for PromptPay mock
    status: str
    payment_method: str
    confirmed_via: Optional[str] = None
    created_at: datetime
    # --- new fields (BAY) ---
    payment_page_url: Optional[str] = None       # EASYPay only — URL for the hidden form POST
    payment_form_params: Optional[Dict[str, str]] = None  # EASYPay only — all hidden form inputs verbatim
    txn_no: Optional[str] = None                 # QR: txnNo from PYMT; EASYPay: orderRef (= ref_code)
```

Add import: `from typing import Dict` (already present if `Optional` is imported from `typing`).

### D.2 TypeScript — frontend type

```typescript
export interface TopupIntentResponse {
  // existing
  ref_code: string;
  wallet_id: number;
  amount: number;
  qr_payload: string;
  status: string;
  payment_method: string;
  confirmed_via: string | null;
  created_at: string;   // ISO datetime
  // new (BAY)
  payment_page_url: string | null;
  payment_form_params: Record<string, string> | null;
  txn_no: string | null;
}
```

File location: wherever `TopupIntentResponse` is currently defined in the frontend — search for `TopupIntentResponse` and extend it.

---

## E. `PaymentIntent` Model Change

File: `backend/app/models/payment_intent.py`

New column to add to the `PaymentIntent` class:

```python
txn_no = Column(String(100), nullable=True, index=True)   # PYMT txnNo (QR) or orderRef (EASYPay)
```

- Type: `VARCHAR(100)` — PYMT txnNos follow pattern `OKTBAY<merchant><seq>`, well under 100 chars.
- Nullable: `True` — populated after PYMT responds. PromptPay mock intents leave it NULL.
- Indexed: `True` — callback handler looks up by `txn_no` on every callback POST.
- Position: add after `qr_payload` column, before `status`.

**Migration note:** The project uses `Base.metadata.create_all(bind=engine)` (see `main.py` line 26), which is additive-only — the new column will be created automatically on next startup in development. For production, a proper Alembic migration is required.

---

## F. Callback Endpoint Spec

### Route

```
POST /api/v1/bay/callback
```

No authentication required (public endpoint — called by PYMT server, not by a logged-in user).

### Request Body

Accepts **both** QR and EASYPay callbacks on the same endpoint. Distinguish by presence of fields:

```python
class BayQrCallbackBody(BaseModel):
    transactionNo: str
    reference1: str
    reference2: Optional[str] = None
    amount: float
    status: Literal["COMPLETED", "FAILED"]

class BayEasyPayCallbackBody(BaseModel):
    orderRef: str
    amount: float
    status: Literal["COMPLETED", "FAILED"]
```

**Unified handler approach:** accept a permissive body and branch by field presence:

```python
class BayCallbackBody(BaseModel):
    # QR fields
    transactionNo: Optional[str] = None
    reference1: Optional[str] = None
    reference2: Optional[str] = None
    # EASYPay fields
    orderRef: Optional[str] = None
    # Shared
    amount: float
    status: Literal["COMPLETED", "FAILED"]
```

### Lookup Logic

```
if body.orderRef is not None:
    # EASYPay callback
    intent = db.query(PaymentIntent).filter(PaymentIntent.ref_code == body.orderRef).first()
elif body.transactionNo is not None:
    # QR callback — try txn_no first, fall back to ref1
    intent = db.query(PaymentIntent).filter(PaymentIntent.txn_no == body.transactionNo).first()
    if not intent and body.reference1:
        intent = db.query(PaymentIntent).filter(PaymentIntent.ref_code == body.reference1).first()
```

### Success Response

```
HTTP 200
Content-Type: application/json

{ "received": true }
```

Always return HTTP 200 — even if the intent is not found or already processed. Returning non-200 causes PYMT to retry indefinitely.

### Idempotency Rule

```python
if intent.status == PaymentIntentStatus.confirmed:
    return {"received": True}   # already credited — skip, return 200
```

If `status == "COMPLETED"` and intent is still `pending`:
- Call `WalletService.confirm_topup(db, intent.ref_code, confirmed_via="gateway_webhook")`
- This credits the wallet and sets `status = confirmed`.

If `status == "FAILED"`:
- Set `intent.status = PaymentIntentStatus.cancelled`
- Do NOT credit the wallet.
- Commit and return 200.

### File to create

`backend/app/api/v1/bay.py`

```python
router = APIRouter()
```

---

## G. Frontend Branching Rule

After `POST /api/v1/wallets/{wallet_id}/topup` returns a `TopupIntentResponse`:

```typescript
if (resp.payment_page_url && resp.payment_form_params) {
  // Real BAY EASYPay path
  // Build a hidden form and auto-submit to BAY's payment page.
  // The ref_code is already embedded in the successUrl/failUrl/cancelUrl
  // that the backend passed to PYMT — no need to pass it again here.
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = resp.payment_page_url;
  Object.entries(resp.payment_form_params).forEach(([k, v]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = k;
    input.value = v;
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();  // browser navigates to BAY payment page
} else {
  // Mock / PromptPay path (existing flow)
  // Store the intent ref in the BAY intent store and navigate to the mock form page.
  storeBayIntent(resp);
  navigate(`/payment/bay/form?ref=${resp.ref_code}`);
}
```

**Important:** Do NOT modify any `payment_form_params` values. BAY validates the `secureHash` against all other params — any modification causes rejection.

---

## H. Success Page Polling Rule

**Page:** `/payment/bay/success` (browser redirect from BAY after payment attempt)

**Status endpoint to poll:**

```
GET /api/v1/wallets/topup/{ref_code}/status
```

This endpoint **does not exist yet**. It must be created in T6. The endpoint returns:

```json
{
  "ref_code": "TOP20260608001",
  "status": "pending" | "confirmed" | "cancelled",
  "amount": 500.00,
  "payment_method": "bay_easypay"
}
```

**Polling algorithm (frontend pseudocode):**

```typescript
const MAX_WAIT_MS = 10_000;   // 10 seconds
const POLL_INTERVAL_MS = 1_500;
const startTime = Date.now();

async function pollStatus(refCode: string) {
  while (Date.now() - startTime < MAX_WAIT_MS) {
    const resp = await GET(`/api/v1/wallets/topup/${refCode}/status`);

    if (resp.status === 'confirmed') {
      // Payment confirmed by PYMT callback — show success UI, skip parent-confirm
      showSuccess();
      redirectToDashboard();
      return;
    }

    if (resp.status === 'cancelled') {
      // Payment failed — show error
      showError('Payment failed. Please try again.');
      return;
    }

    // status === 'pending' — keep polling
    await sleep(POLL_INTERVAL_MS);
  }

  // Timeout: callback did not arrive within 10 s
  // Fall back to parent-confirm (existing manual confirmation flow)
  await POST(`/api/v1/wallets/topup/${refCode}/parent-confirm`);
  showSuccess();
  redirectToDashboard();
}
```

**Rule:** If the PYMT callback has already been processed (status = `confirmed`) by the time the browser lands on the success page, skip parent-confirm entirely. The wallet has already been credited by the callback handler.

**T6 task:** Create `GET /api/v1/wallets/topup/{ref_code}/status` — returns the intent's current status, amount, and payment_method. Auth: same roles as the topup creation endpoint (`parent`, `staff`, `admin`, etc.).

---

## I. Router Registration Pattern

**Primary file:** `backend/app/main.py`

The pattern for adding a new router is:

### Step 1 — Create the router module

`backend/app/api/v1/bay.py`:

```python
from fastapi import APIRouter
router = APIRouter()

# ... route definitions ...
```

### Step 2 — Import in `main.py`

Add to the import block (lines 17-22):

```python
from app.api.v1 import (
    products, auth, shops, inventory, pos, returns, wallets, customers,
    family, users, users_admin, sync,
    admin_cardholders, admin_departments, admin_audit, admin_settings, departments, reports,
    uom, bundles, price_panels, canteen, admin_import, customer_display,
    bay,   # <-- add here
)
```

### Step 3 — Register the router

Add after line 97 (after `customer_display.admin_router`):

```python
app.include_router(bay.router, prefix="/api/v1/bay", tags=["BAY Payments"])
```

**Result:** All routes defined with `@router.post("/callback")` in `bay.py` will be reachable at `POST /api/v1/bay/callback`.

**Note on `api/v1/__init__.py`:** The current file (`backend/app/api/v1/__init__.py`) contains only `from app.api.v1 import price_panels  # noqa`. This is a side-effect import for table registration, not used for routing. Do NOT add the bay router there — register it in `main.py` as shown above.

---

## Appendix: Payment Method Values

The `payment_method` column on `PaymentIntent` (and `TopupRequest.payment_method`) uses these string values:

| Value | Meaning |
|---|---|
| `qr_promptpay` | Existing mock PromptPay QR flow |
| `bay_qr` | BAY QR payment via PYMT |
| `bay_easypay` | BAY EASYPay credit card via PYMT |
| `cash` | Cash top-up (cashier) |
| `credit_card` | Generic credit card (legacy) |

Frontend sends `payment_method: "bay_qr"` or `"bay_easypay"` in `TopupRequest`. Backend branches on this value to call the correct PYMT endpoint.

---

## Appendix: ref1 / ref2 Sanitization

PYMT / BAY constraints: max 20 chars, alphanumeric only.

`ref_code` values are like `TOP-20260608-001` (16 chars with hyphens). Strip non-alphanumeric characters before sending:

```python
import re

def sanitize_ref(value: str, max_len: int = 20) -> str:
    return re.sub(r'[^A-Za-z0-9]', '', value)[:max_len]
```

Example: `TOP-20260608-001` → `TOP20260608001` (14 chars, within 20).

---

## Open Questions / Assumptions

1. **`BAY_CALLBACK_SECRET`**: The PYMT merchant guide (v2026-05-16) documents no callback verification mechanism — no shared secret header, no HMAC. This contract marks it as not applicable. **Assumption**: prototype relies on network-level security only. Confirm with PYMT team before production.

2. **Single callback endpoint for both QR and EASYPay**: The guide registers one `callbackUrl` per merchant. Both QR and EASYPay callbacks POST to the same URL. The unified `BayCallbackBody` approach (field-presence branching) handles this. Verify with PYMT team if separate `callbackUrl` values per payment type are supported/preferred.

3. **`ref1` encoding for BAY QR**: `ref_code` like `TOP-20260608-001` contains hyphens. After stripping: `TOP20260608001` = 14 chars alphanumeric. This fits within the 20-char limit. Confirmed safe.

4. **`GET /api/v1/wallets/topup/{ref_code}/status` does not exist**: Must be created in T6. The existing `parent-confirm` endpoint (`POST /api/v1/wallets/topup/{ref_code}/parent-confirm`) only confirms — it does not return status. The success page poller needs a read-only status endpoint.

5. **EASYPay `orderRef` is the `ref_code` directly** (not the stripped alphanumeric form). `ref_code` fits within BAY's 35-char limit and contains no characters that BAY's EASYPay rejects at the registration step. The `secureHash` is computed by PYMT, so the value just needs to round-trip cleanly.

6. **Frontend redirect URLs**: The `successUrl`, `failUrl`, and `cancelUrl` sent to PYMT must be absolute URLs reachable by BAY's servers (i.e., not `localhost`). The backend must either accept them as input from the frontend, or derive them from a `FRONTEND_BASE_URL` env var. This is not yet defined — **T2 (backend BAY service) must accept these as parameters in the `TopupRequest` or derive from config**.

7. **`qr_payload` field in `TopupIntentResponse`**: Currently typed `str` (non-optional). For `bay_qr` intents, this field should carry the `qrcodeContent` returned by PYMT. The current schema uses `qr_payload or ""` in the endpoint — T2 should store `qrcodeContent` in `PaymentIntent.qr_payload` and return it here. No schema change needed for this field.
