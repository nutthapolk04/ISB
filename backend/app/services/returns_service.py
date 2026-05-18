"""
Returns & Exchange Service
Handles return requests, approvals, refunds, and exchanges.
Restores stock on approved returns.
"""
from __future__ import annotations

import time
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from sqlalchemy.orm import Session
from sqlalchemy import desc

from app.models.return_request import ReturnRequest, ReturnStatus
from app.models.receipt import Receipt, PaymentMethod
from app.models.shop import ShopProduct, ShopMovement, MovementType
from app.models.wallet import Wallet, WalletTransaction, WalletTransactionType


class ReturnsService:

    # ── Create return request(s) ─────────────────────────────────────────────

    @staticmethod
    def create_return(
        db: Session,
        *,
        receipt_id: str,
        items: List[dict],
        reason: str,
        user_id: int,
    ) -> List[ReturnRequest]:
        """Create one ReturnRequest row per returned product line.
        Validates that return quantity does not exceed remaining returnable quantity.
        """
        created: List[ReturnRequest] = []

        for item in items:
            purchased_qty = item["quantity"]
            requested_qty = item["returnQuantity"]

            # Sum already-returned quantity (pending + approved) for this product on this receipt
            existing_returns = (
                db.query(ReturnRequest)
                .filter(
                    ReturnRequest.receipt_id == receipt_id,
                    ReturnRequest.product_code == item["productCode"],
                    ReturnRequest.status != ReturnStatus.rejected,
                )
                .all()
            )
            already_returned_qty = sum(r.return_quantity for r in existing_returns)
            remaining_qty = purchased_qty - already_returned_qty

            if remaining_qty <= 0:
                raise ValueError(
                    f"Product '{item['productCode']}' from receipt '{receipt_id}' "
                    f"has already been fully returned ({already_returned_qty}/{purchased_qty})"
                )
            if requested_qty > remaining_qty:
                raise ValueError(
                    f"Product '{item['productCode']}': requested {requested_qty} "
                    f"but only {remaining_qty} remaining (purchased {purchased_qty}, already returned {already_returned_qty})"
                )

            total_after = already_returned_qty + requested_qty
            rr = ReturnRequest(
                receipt_id=receipt_id,
                product_code=item["productCode"],
                product_name=item["productName"],
                quantity=purchased_qty,
                return_quantity=requested_qty,
                price=item.get("price", 0),
                reason=reason,
                status=ReturnStatus.pending,
                return_status=(
                    "full-return" if total_after >= purchased_qty
                    else "partial-return"
                ),
                created_by=user_id,
            )
            db.add(rr)
            created.append(rr)

        db.commit()
        for rr in created:
            db.refresh(rr)
        return created

    # ── Create return without receipt ─────────────────────────────────────────

    @staticmethod
    def create_return_without_receipt(
        db: Session,
        *,
        items: List[dict],
        reason: str,
        customer_name: Optional[str] = None,
        notes: Optional[str] = None,
        user_id: int,
    ) -> List[ReturnRequest]:
        """Create return requests without linking to a specific receipt.

        Used when customer doesn't have a receipt but product is confirmed as store merchandise.
        Generates a special receipt ID with NO-RCPT prefix.
        """
        import time

        created: List[ReturnRequest] = []

        # Generate a unique placeholder receipt ID
        no_receipt_id = f"NO-RCPT-{int(time.time())}"

        for item in items:
            # Validate product exists in the specified shop
            product = (
                db.query(ShopProduct)
                .filter(
                    ShopProduct.product_code == item["productCode"],
                    ShopProduct.shop_id == item["shopId"],
                    ShopProduct.is_active == True,
                )
                .first()
            )
            if not product:
                raise ValueError(
                    f"Product '{item['productCode']}' not found in shop '{item['shopId']}'"
                )

            # Build reason with customer info if provided
            full_reason = reason
            if customer_name:
                full_reason = f"{reason} (Customer: {customer_name})"
            if notes:
                full_reason = f"{full_reason} | Notes: {notes}"

            rr = ReturnRequest(
                receipt_id=no_receipt_id,
                product_code=item["productCode"],
                product_name=item["productName"],
                quantity=item["returnQuantity"],  # For no-receipt returns, quantity = returnQuantity
                return_quantity=item["returnQuantity"],
                price=item.get("unitPrice", 0),
                reason=full_reason,
                status=ReturnStatus.pending,
                return_status="full-return",
                created_by=user_id,
            )
            db.add(rr)
            created.append(rr)

        db.commit()
        for rr in created:
            db.refresh(rr)
        return created

    # ── List returns ─────────────────────────────────────────────────────────

    @staticmethod
    def list_returns(
        db: Session,
        *,
        q: Optional[str] = None,
    ) -> List[ReturnRequest]:
        query = db.query(ReturnRequest).order_by(desc(ReturnRequest.created_at))
        if q:
            query = query.filter(
                ReturnRequest.receipt_id.ilike(f"%{q}%")
                | ReturnRequest.product_name.ilike(f"%{q}%")
            )
        return query.all()

    # ── Get returns by receipt ────────────────────────────────────────────────

    @staticmethod
    def get_returns_by_receipt_id(
        db: Session,
        receipt_id: str,
    ) -> List[ReturnRequest]:
        """Get all active (non-rejected) return requests for a specific receipt."""
        return (
            db.query(ReturnRequest)
            .filter(
                ReturnRequest.receipt_id == receipt_id,
                ReturnRequest.status != ReturnStatus.rejected,
            )
            .order_by(desc(ReturnRequest.created_at))
            .all()
        )

    # ── Get single return ────────────────────────────────────────────────────

    @staticmethod
    def get_return(db: Session, return_id: int) -> Optional[ReturnRequest]:
        return db.query(ReturnRequest).filter(ReturnRequest.id == return_id).first()

    # ── Update return ────────────────────────────────────────────────────────

    @staticmethod
    def update_return(
        db: Session,
        return_id: int,
        **fields,
    ) -> Optional[ReturnRequest]:
        rr = db.query(ReturnRequest).filter(ReturnRequest.id == return_id).first()
        if not rr:
            return None

        field_map = {
            "productName": "product_name",
            "quantity": "quantity",
            "returnQuantity": "return_quantity",
            "reason": "reason",
            "status": "status",
            "priceType": "price_type",
        }
        for key, col in field_map.items():
            if key in fields and fields[key] is not None:
                val = fields[key]
                if key == "status":
                    val = ReturnStatus(val)
                setattr(rr, col, val)

        # If approved → restore stock
        if fields.get("status") == "approved":
            ReturnsService._restore_stock(db, rr)

        db.commit()
        db.refresh(rr)
        return rr

    # ── Delete return ────────────────────────────────────────────────────────

    @staticmethod
    def delete_return(db: Session, return_id: int) -> bool:
        rr = db.query(ReturnRequest).filter(ReturnRequest.id == return_id).first()
        if not rr:
            return False
        db.delete(rr)
        db.commit()
        return True

    # ── Process refund ───────────────────────────────────────────────────────

    @staticmethod
    def process_refund(
        db: Session,
        return_id: int,
        *,
        return_items: List[dict],
        refund_method: Optional[str] = None,  # deprecated — backend derives from receipt
        reason: str,
        notes: Optional[str] = None,
        user_id: int,
    ) -> dict:
        rr = db.query(ReturnRequest).filter(ReturnRequest.id == return_id).first()
        if not rr:
            raise ValueError(f"Return request {return_id} not found")

        refund_amount = float(rr.price) * rr.return_quantity
        amount_dec = Decimal(str(refund_amount))

        # Lookup original receipt to derive refund destination
        receipt = (
            db.query(Receipt)
            .filter(Receipt.receipt_number == rr.receipt_id)
            .first()
        )

        # Restore stock first
        ReturnsService._restore_stock(db, rr, user_id=user_id)

        derived_method, refunded_to = ReturnsService._derive_refund_destination(
            db,
            receipt=receipt,
            amount_dec=amount_dec,
            rr=rr,
            user_id=user_id,
        )

        rr.status = ReturnStatus.approved
        rr.refund_method = derived_method
        rr.refund_amount = refund_amount
        rr.processed_at = datetime.utcnow()

        db.commit()
        db.refresh(rr)

        return {
            "id": f"RF-{rr.id:03d}",
            "refundAmount": refund_amount,
            "refundMethod": derived_method,
            "refundedTo": refunded_to,
            "status": "completed",
            "timestamp": rr.processed_at.isoformat(),
        }

    # ── Derive refund destination from original receipt ──────────────────────

    @staticmethod
    def _derive_refund_destination(
        db: Session,
        *,
        receipt: Optional[Receipt],
        amount_dec: Decimal,
        rr: ReturnRequest,
        user_id: int,
    ) -> tuple[str, dict]:
        """Determine where the refund goes based on the original receipt.

        Returns (method_code, refunded_to_dict). For wallet-based payments,
        credits the originating wallet and creates a WalletTransaction(REFUND).
        For EDC / cash / other, only returns metadata; cashier handles physical
        refund. Returns ("cash", {...}) as fallback when receipt is missing.
        """
        if not receipt:
            return "cash", {
                "type": "cash",
                "label": "Cash drawer (receipt not found)",
            }

        pm = receipt.payment_method

        # Wallet-based payments → credit originating wallet
        if pm in (PaymentMethod.WALLET, PaymentMethod.CARD_TAP, PaymentMethod.DEPARTMENT):
            target_wallet: Optional[Wallet] = None
            target_type = ""
            target_label = ""

            if receipt.customer_id:
                target_wallet = db.query(Wallet).filter(Wallet.customer_id == receipt.customer_id).first()
                target_type = "customer_wallet"
                target_label = f"Customer wallet #{receipt.customer_id}"
            elif receipt.payer_user_id:
                target_wallet = db.query(Wallet).filter(Wallet.user_id == receipt.payer_user_id).first()
                target_type = "user_wallet"
                target_label = f"User wallet #{receipt.payer_user_id}"
            elif receipt.payer_department_id:
                target_wallet = db.query(Wallet).filter(Wallet.department_id == receipt.payer_department_id).first()
                target_type = "department_wallet"
                target_label = f"Department wallet #{receipt.payer_department_id}"

            if target_wallet:
                balance_before = Decimal(str(target_wallet.balance))
                target_wallet.balance = balance_before + amount_dec
                wtx = WalletTransaction(
                    wallet_id=target_wallet.id,
                    transaction_type=WalletTransactionType.REFUND,
                    amount=amount_dec,
                    balance_before=balance_before,
                    balance_after=target_wallet.balance,
                    reference_type="return_request",
                    reference_id=rr.id,
                    description=f"Refund for return {rr.id} (receipt {rr.receipt_id})",
                    created_by=user_id,
                )
                db.add(wtx)
                return target_type, {
                    "type": target_type,
                    "label": target_label,
                    "walletId": target_wallet.id,
                    "balanceBefore": float(balance_before),
                    "balanceAfter": float(target_wallet.balance),
                }

            # Wallet payment but no wallet found — fall through to cash
            return "cash", {
                "type": "cash",
                "label": f"Cash drawer (wallet for {pm.value} payer not found)",
            }

        # EDC / credit / debit card → cashier processes refund on EDC terminal
        if pm in (PaymentMethod.EDC, PaymentMethod.CREDIT_CARD, PaymentMethod.DEBIT_CARD):
            return "edc_card", {
                "type": "edc_card",
                "label": "EDC card refund",
                "maskedCard": receipt.edc_masked_card or "",
                "edcTerminalRef": receipt.edc_terminal_ref or "",
                "edcApprovalCode": receipt.edc_approval_code or "",
            }

        # Cash / bank_transfer / other → cashier opens drawer or processes manually
        method = pm.value if pm else "cash"
        return method, {
            "type": method,
            "label": f"{method.replace('_', ' ').title()} refund",
        }

    # ── Process exchange ─────────────────────────────────────────────────────

    @staticmethod
    def process_exchange(
        db: Session,
        return_id: int,
        *,
        return_items: List[dict],
        exchange_items: List[dict],
        difference: float,
        reason: str,
        notes: Optional[str] = None,
        user_id: int,
    ) -> dict:
        rr = db.query(ReturnRequest).filter(ReturnRequest.id == return_id).first()
        if not rr:
            raise ValueError(f"Return request {return_id} not found")

        return_value = float(rr.price) * rr.return_quantity

        # Restore returned stock
        ReturnsService._restore_stock(db, rr, user_id=user_id)

        # Deduct exchanged items stock
        exchange_value = 0.0
        exchange_codes = []
        for ex_item in exchange_items:
            product = (
                db.query(ShopProduct)
                .filter(ShopProduct.product_code == ex_item["productCode"])
                .first()
            )
            if product:
                qty = ex_item["quantity"]
                stock_before = product.stock
                product.stock = stock_before - qty
                exchange_value += float(product.external_price) * qty
                exchange_codes.append(ex_item["productCode"])

                movement = ShopMovement(
                    date=date.today(),
                    product_id=product.id,
                    product_name=product.name,
                    shop_id=product.shop_id,
                    type=MovementType.exchange,
                    quantity=-qty,
                    stock_before=stock_before,
                    stock_after=product.stock,
                    cost_per_unit=float(product.avg_cost),
                    reference=f"EX-{rr.id:03d}",
                    note=f"Exchange from return {rr.receipt_id}",
                    created_by=user_id,
                )
                db.add(movement)

        rr.status = ReturnStatus.approved
        rr.exchange_product_codes = ",".join(exchange_codes)
        rr.exchange_amount = exchange_value
        rr.refund_amount = return_value
        rr.processed_at = datetime.utcnow()

        db.commit()
        db.refresh(rr)

        return {
            "id": f"EX-{rr.id:03d}",
            "returnValue": return_value,
            "exchangeValue": exchange_value,
            "difference": exchange_value - return_value,
            "status": "completed",
            "timestamp": rr.processed_at.isoformat(),
        }

    # ── Return history ───────────────────────────────────────────────────────

    @staticmethod
    def get_return_history(
        db: Session,
        q: Optional[str] = None,
    ) -> List[dict]:
        query = (
            db.query(ReturnRequest)
            .filter(ReturnRequest.status != ReturnStatus.pending)
            .order_by(desc(ReturnRequest.processed_at))
        )
        if q:
            query = query.filter(
                ReturnRequest.receipt_id.ilike(f"%{q}%")
                | ReturnRequest.product_name.ilike(f"%{q}%")
            )

        results = []
        for rr in query.all():
            exchanged = []
            if rr.exchange_product_codes:
                exchanged = [c.strip() for c in rr.exchange_product_codes.split(",") if c.strip()]

            # Fall back to price × qty when refund_amount was never set.
            computed_return = float(rr.price or 0) * int(rr.return_quantity or 0)
            return_val = float(rr.refund_amount) if rr.refund_amount is not None else computed_return
            exchange_val = float(rr.exchange_amount or 0)
            results.append({
                "id": f"RT-{rr.id:03d}",
                "date": rr.processed_at.strftime("%Y-%m-%d %H:%M") if rr.processed_at else rr.created_at.strftime("%Y-%m-%d %H:%M"),
                "receiptId": rr.receipt_id,
                "studentId": "",
                "studentName": "",
                "returnedItems": [f"{rr.product_name} x{rr.return_quantity}"],
                "exchangedItems": exchanged,
                "returnValue": return_val,
                "exchangeValue": exchange_val,
                "difference": exchange_val - return_val,
                "status": rr.status.value,
                "reason": rr.reason,
            })
        return results

    # ── Search receipts for return page ──────────────────────────────────────

    @staticmethod
    def search_receipt(
        db: Session,
        *,
        receipt_id: Optional[str] = None,
        student_code: Optional[str] = None,
    ) -> Optional[dict]:
        if not receipt_id and not student_code:
            return None

        if student_code and not receipt_id:
            # Look up customer by student_code or customer_code
            from app.models.customer import Customer
            customer = (
                db.query(Customer)
                .filter(
                    (Customer.student_code == student_code) |
                    (Customer.customer_code == student_code)
                )
                .first()
            )
            if not customer:
                return None
            receipt = (
                db.query(Receipt)
                .filter(Receipt.customer_id == customer.id)
                .order_by(desc(Receipt.created_at))
                .first()
            )
        else:
            receipt = (
                db.query(Receipt)
                .filter(Receipt.receipt_number.ilike(f"%{receipt_id}%"))
                .first()
            )
        if not receipt:
            return None

        items = []
        shop_id = None
        for item in receipt.items:
            pv = item.product_variant  # ShopProduct
            if pv and not shop_id:
                shop_id = pv.shop_id
            items.append({
                "productCode": pv.product_code if pv else "UNKNOWN",
                "productName": pv.name if pv else "Unknown",
                "quantity": item.quantity,
                "price": float(item.unit_price),
            })

        # Derive payer info for refund-destination preview on the frontend
        payer_info: dict = {"type": "unknown", "label": ""}
        if receipt.customer_id and receipt.customer:
            payer_info = {
                "type": "customer",
                "label": receipt.customer.name or receipt.customer.customer_code or "",
                "id": receipt.customer_id,
            }
        elif receipt.payer_user_id and receipt.payer_user:
            payer_info = {
                "type": "user",
                "label": receipt.payer_user.full_name or receipt.payer_user.username or "",
                "id": receipt.payer_user_id,
            }
        elif receipt.payer_department_id and receipt.payer_department:
            payer_info = {
                "type": "department",
                "label": receipt.payer_department.department_name or "",
                "id": receipt.payer_department_id,
            }

        return {
            "id": receipt.receipt_number,
            "date": receipt.transaction_date.strftime("%Y-%m-%d %H:%M") if receipt.transaction_date else "",
            "items": items,
            "total": float(receipt.total),
            "paymentMethod": receipt.payment_method.value if receipt.payment_method else "cash",
            "shopId": shop_id,
            "payer": payer_info,
            "edcMaskedCard": receipt.edc_masked_card or None,
        }

    # ── Internal helpers ─────────────────────────────────────────────────────

    @staticmethod
    def _restore_stock(db: Session, rr: ReturnRequest, user_id: Optional[int] = None):
        """Find the ShopProduct by product_code and restore stock."""
        product = (
            db.query(ShopProduct)
            .filter(ShopProduct.product_code == rr.product_code)
            .first()
        )
        if not product:
            return

        stock_before = product.stock
        product.stock = stock_before + rr.return_quantity

        movement = ShopMovement(
            date=date.today(),
            product_id=product.id,
            product_name=product.name,
            shop_id=product.shop_id,
            type=MovementType.void,
            quantity=rr.return_quantity,
            stock_before=stock_before,
            stock_after=product.stock,
            cost_per_unit=float(rr.price),
            reference=f"RTN-{rr.receipt_id}",
            note=rr.reason,
            created_by=user_id or rr.created_by,
        )
        db.add(movement)
