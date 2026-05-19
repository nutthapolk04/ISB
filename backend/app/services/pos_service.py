"""
POS Service — checkout, receipt retrieval, and void operations.
Deducts stock from ShopProduct, records ShopMovement, creates Receipt + items.
"""
from __future__ import annotations

import time
from datetime import date, datetime
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session, joinedload
from sqlalchemy import desc

from app.models.receipt import Receipt, ReceiptItem, TransactionMode, PaymentMethod, ReceiptStatus
from app.models.shop import ShopProduct, ShopMovement, MovementType, Shop, MenuOption, MenuOptionGroup
from app.models.fifo_lot import FifoLot
from app.models.customer import Customer
from app.models.wallet import Wallet, WalletTransaction, WalletTransactionType
from app.models.bundle import ProductBundle, BundleItem
from app.services.wallet_service import WalletService
from app.services.settings_service import SettingsService
import logging
from app.services.audit_service import create_audit_log
from app.core.errors import BusinessRuleError

_audit_logger = logging.getLogger("audit")
from decimal import Decimal
from app.services.inventory_service import (
    calc_new_avg_cost,
    calc_fifo_avg_cost,
    _deduct_fifo_lots_in_memory,
)


def _resolve_options(
    db: Session,
    product_id: int,
    selected: List[dict],
) -> Tuple[Optional[dict], float]:
    """Validate selected menu options against the product's option groups.

    Returns a `(snapshot_json, options_total)` pair. `snapshot_json` is a
    denormalised dict (safe to stash on receipt_items.options) or None if no
    options were selected. Raises ValueError on required-missing /
    max-exceeded / unknown-option violations.
    """
    if not selected:
        return None, 0.0

    # Fetch the full option catalog for this product in one query.
    groups: List[MenuOptionGroup] = (
        db.query(MenuOptionGroup)
        .filter(MenuOptionGroup.product_id == product_id)
        .all()
    )
    options_by_id: dict[int, MenuOption] = {
        opt.id: opt for g in groups for opt in g.options
    }
    group_by_id: dict[int, MenuOptionGroup] = {g.id: g for g in groups}

    # Aggregate selections per group so we can validate required/max.
    per_group: dict[int, list[tuple[MenuOption, int]]] = {}
    total = 0.0
    for sel in selected:
        oid = sel["option_id"]
        qty = int(sel.get("quantity") or 1)
        if qty < 1:
            raise ValueError(f"Option quantity must be >= 1 (got {qty})")
        opt = options_by_id.get(oid)
        if not opt:
            raise ValueError(f"Unknown menu option id {oid} for product {product_id}")
        per_group.setdefault(opt.option_group_id, []).append((opt, qty))
        total += float(opt.price_delta) * qty

    # Validate: required groups have ≥1 selection; max_selections respected.
    for g in groups:
        picks = per_group.get(g.id, [])
        pick_count = sum(q for _, q in picks) if g.selection_type.value == "quantity" else len(picks)
        if g.is_required and pick_count < 1:
            raise ValueError(f"Option group '{g.name}' is required")
        if g.max_selections is not None and pick_count > g.max_selections:
            raise ValueError(
                f"Option group '{g.name}' allows at most {g.max_selections} selections"
            )
        if g.selection_type.value == "single" and len(picks) > 1:
            raise ValueError(f"Option group '{g.name}' allows only one selection")

    # Build JSON snapshot grouped for rendering.
    groups_out = []
    # Preserve group order (by sort_order then id)
    for g in sorted(groups, key=lambda x: (x.sort_order, x.id)):
        picks = per_group.get(g.id)
        if not picks:
            continue
        groups_out.append({
            "group_id": g.id,
            "name": g.name,
            "selection_type": g.selection_type.value,
            "options": [
                {
                    "option_id": opt.id,
                    "name": opt.name,
                    "price_delta": float(opt.price_delta),
                    "quantity": qty,
                }
                for opt, qty in picks
            ],
        })
    return {"groups": groups_out, "options_total": round(total, 2)}, round(total, 2)


def _deduct_product_stock(
    db: Session,
    product: ShopProduct,
    qty: int,
    receipt_number: str,
    movement_type: MovementType,
    notes: str | None,
    user_id: int,
) -> None:
    """Deduct stock from a single ShopProduct, recording a ShopMovement.

    Shared by normal checkout items and bundle sub-SKU deductions.
    Negative stock is allowed per project requirements.
    """
    stock_before = product.stock
    shop = product.shop

    if shop and shop.shop_type.value == "fifo":
        existing_lots = (
            db.query(FifoLot)
            .filter(FifoLot.product_id == product.id)
            .all()
        )
        new_lot_dicts = _deduct_fifo_lots_in_memory(
            existing_lots, qty, product.id, shop.id
        )
        db.query(FifoLot).filter(FifoLot.product_id == product.id).delete()
        db.flush()
        for ld in new_lot_dicts:
            db.add(FifoLot(**ld))
        db.flush()
        remaining_lots = (
            db.query(FifoLot)
            .filter(FifoLot.product_id == product.id)
            .all()
        )
        product.stock = int(sum(float(l.qty_remaining) for l in remaining_lots))
        product.avg_cost = round(calc_fifo_avg_cost(remaining_lots), 4)
    else:
        product.stock = stock_before - qty

    movement = ShopMovement(
        date=date.today(),
        product_id=product.id,
        product_name=product.name,
        shop_id=product.shop_id,
        type=movement_type,
        quantity=-qty,
        stock_before=stock_before,
        stock_after=product.stock,
        cost_per_unit=float(product.avg_cost),
        reference=receipt_number,
        note=notes,
        created_by=user_id,
    )
    db.add(movement)


def _generate_receipt_number(db: Session) -> str:
    """Generate a unique receipt number: R-YYYYMMDD-NNN"""
    today_str = date.today().strftime("%Y%m%d")
    prefix = f"R-{today_str}-"
    last = (
        db.query(Receipt)
        .filter(Receipt.receipt_number.like(f"{prefix}%"))
        .order_by(desc(Receipt.id))
        .first()
    )
    if last:
        try:
            seq = int(last.receipt_number.split("-")[-1]) + 1
        except ValueError:
            seq = 1
    else:
        seq = 1
    return f"{prefix}{seq:03d}"


class POSService:

    # ── Checkout ─────────────────────────────────────────────────────────────

    @staticmethod
    def checkout(
        db: Session,
        *,
        transaction_mode: str,
        payment_method: str,
        items: List[dict],
        user_id: int,
        customer_id: Optional[int] = None,
        payer_kind: str = "customer",
        payer_user_id: Optional[int] = None,
        payer_department_id: Optional[int] = None,
        requester_user_id: Optional[int] = None,
        notes: Optional[str] = None,
        shop_id: Optional[str] = None,
        bill_discount: float = 0,
        edc_terminal_ref: Optional[str] = None,
        edc_approval_code: Optional[str] = None,
        edc_masked_card: Optional[str] = None,
    ) -> Receipt:
        """
        Create a receipt and deduct stock for each item.
        Negative stock IS allowed (per project requirements).
        """
        # ── EDC payment validation: approval_code required ──
        if payment_method == "edc":
            if not (edc_approval_code and edc_approval_code.strip()):
                raise ValueError("EDC payment requires approval_code")

        # ── Department charge validation: coop shops only ──
        if payment_method == "department":
            # Resolve the shop: explicit shop_id, else first item's shop.
            target_shop_id = shop_id
            if not target_shop_id and items:
                first_product = (
                    db.query(ShopProduct)
                    .filter(ShopProduct.id == items[0]["product_variant_id"])
                    .first()
                )
                if first_product:
                    target_shop_id = first_product.shop_id
            if not target_shop_id:
                raise ValueError("Department charge requires a shop context")
            shop_row = db.query(Shop).filter(Shop.id == target_shop_id).first()
            if not shop_row:
                raise ValueError(f"Shop '{target_shop_id}' not found")
            if not shop_row.allow_department_charge:
                raise ValueError(
                    f"Shop '{target_shop_id}' does not accept department charges "
                    f"(only coop shops can issue goods on department budget)"
                )

        receipt_number = _generate_receipt_number(db)

        subtotal = 0.0
        receipt_items: List[ReceiptItem] = []

        movement_type = (
            MovementType.internal_use
            if transaction_mode == "internal_issue"
            else MovementType.sale
        )

        for item in items:
            qty = item["quantity"]
            unit_price = float(item["unit_price"])
            discount = float(item.get("discount", 0))

            # One-time POS price override — when present, the line is billed
            # at this value instead of `unit_price`. Catalog price stays for
            # audit on the receipt; override is captured separately.
            override_raw = item.get("price_override")
            price_override = (
                float(override_raw) if override_raw is not None and override_raw != "" else None
            )
            effective_price = price_override if price_override is not None else unit_price

            # ── Bundle / Grade-Set handling ──────────────────────────────
            if item.get("is_bundle") and item.get("bundle_id"):
                bundle: ProductBundle | None = (
                    db.query(ProductBundle)
                    .filter(ProductBundle.id == item["bundle_id"])
                    .first()
                )
                if not bundle:
                    raise ValueError(f"Bundle id={item['bundle_id']} not found")

                bundle_items: list[BundleItem] = (
                    db.query(BundleItem)
                    .filter(BundleItem.bundle_id == bundle.id)
                    .all()
                )
                if not bundle_items:
                    raise ValueError(f"Bundle id={bundle.id} has no items")

                # Deduct stock for every sub-SKU
                anchor_product_id: int | None = None
                for bi in bundle_items:
                    sub_product: ShopProduct | None = (
                        db.query(ShopProduct)
                        .filter(ShopProduct.id == bi.product_id)
                        .first()
                    )
                    if not sub_product:
                        raise ValueError(
                            f"Bundle sub-product id={bi.product_id} not found"
                        )
                    if anchor_product_id is None:
                        anchor_product_id = sub_product.id
                    _deduct_product_stock(
                        db,
                        sub_product,
                        bi.quantity * qty,
                        receipt_number,
                        movement_type,
                        notes,
                        user_id,
                    )

                # One clean receipt line for the bundle
                line_total = round(effective_price * qty - discount, 2)
                subtotal += line_total
                receipt_items.append(ReceiptItem(
                    product_variant_id=anchor_product_id,
                    quantity=qty,
                    unit_price=unit_price,
                    price_override=price_override,
                    discount=discount,
                    line_total=line_total,
                    options={
                        "is_bundle": True,
                        "bundle_id": bundle.id,
                        "bundle_name": bundle.name,
                        "bundle_code": bundle.bundle_code,
                    },
                ))
                continue

            # ── Normal (non-bundle) item ─────────────────────────────────
            product: ShopProduct = (
                db.query(ShopProduct)
                .filter(ShopProduct.id == item["product_variant_id"])
                .first()
            )
            if not product:
                raise ValueError(f"Product id={item['product_variant_id']} not found")

            # ── Menu options: resolve + validate ─────────────────────────
            options_snapshot, options_total = _resolve_options(
                db, product.id, item.get("options") or []
            )
            line_total = round((effective_price + options_total) * qty - discount, 2)
            subtotal += line_total

            receipt_items.append(ReceiptItem(
                product_variant_id=product.id,
                quantity=qty,
                unit_price=unit_price,
                price_override=price_override,
                discount=discount,
                line_total=line_total,
                options=options_snapshot,
            ))

            # ── Deduct stock ────────────────────────────────────────────
            _deduct_product_stock(
                db, product, qty, receipt_number, movement_type, notes, user_id
            )

        bill_discount_amt = max(0.0, min(float(bill_discount), subtotal))
        total = round(subtotal - bill_discount_amt, 2)

        # ── Wallet + card checks ─────────────────────────────────────────────
        # "card_tap" (MIFARE) is a wallet payment initiated by tapping the card;
        # the cashier UI resolves card_uid → customer_id before calling checkout.
        # `payer_kind` selects between a Customer wallet (student/visitor),
        # a User wallet (parent/staff personal), and a Department wallet
        # (coop dept charge — payment_method=department).
        wallet_tx_data: Optional[dict] = None
        is_wallet_payment = payment_method in ("wallet", "card_tap")
        is_department_payment = payment_method == "department"

        if is_department_payment:
            if not payer_department_id:
                raise ValueError("Department charge requires payer_department_id")
            wallet = db.query(Wallet).filter(Wallet.department_id == payer_department_id).first()
            if not wallet:
                wallet = WalletService.ensure_wallet_for_department(db, payer_department_id)
                db.flush()
            balance_before = Decimal(str(wallet.balance))
            amount_dec = Decimal(str(total))
            wallet.balance = balance_before - amount_dec  # negative allowed
            wallet_tx_data = {
                "wallet_id": wallet.id,
                "balance_before": balance_before,
                "balance_after": wallet.balance,
                "amount": amount_dec,
            }
        elif is_wallet_payment and payer_kind == "user" and payer_user_id is not None:
            wallet = db.query(Wallet).filter(Wallet.user_id == payer_user_id).first()
            if not wallet:
                wallet = WalletService.ensure_wallet_for_user(db, payer_user_id)
                db.flush()

            balance_before = Decimal(str(wallet.balance))
            amount_dec = Decimal(str(total))
            projected_balance = balance_before - amount_dec
            allow_neg_user = SettingsService.get_bool(db, "allow_negative_user_wallet", default=False)
            if not allow_neg_user and projected_balance < 0:
                raise BusinessRuleError(
                    code="INSUFFICIENT_USER_WALLET",
                    params={"balance": float(balance_before), "amount": float(total)},
                    message=(
                        f"ยอดเงินใน wallet ไม่พอ. คงเหลือ ฿{float(balance_before):.2f}, "
                        f"ต้องชำระ ฿{total:.2f}"
                    ),
                )
            wallet.balance = projected_balance
            wallet_tx_data = {
                "wallet_id": wallet.id,
                "balance_before": balance_before,
                "balance_after": wallet.balance,
                "amount": amount_dec,
            }
        elif is_wallet_payment and customer_id is not None:
            customer = db.query(Customer).filter(Customer.id == customer_id).first()
            if not customer:
                raise ValueError(f"Customer id={customer_id} not found")

            if customer.card_frozen:
                raise ValueError(f"Card is frozen for {customer.name}. Ask parent to unfreeze.")

            wallet = db.query(Wallet).filter(Wallet.customer_id == customer_id).first()
            if not wallet:
                wallet = WalletService.ensure_wallet_for_customer(db, customer_id)
                db.flush()

            # Daily limit check
            if customer.daily_limit is not None:
                today_spent = WalletService.today_deducted(db, wallet.id)
                limit = float(customer.daily_limit)
                if today_spent + total > limit:
                    remaining = max(0, limit - today_spent)
                    raise ValueError(
                        f"Daily limit exceeded. Limit: ฿{limit:.2f}, already spent today: ฿{today_spent:.2f}, remaining: ฿{remaining:.2f}"
                    )

            # Prepare wallet transaction data (actual deduction after receipt created)
            balance_before = Decimal(str(wallet.balance))
            amount_dec = Decimal(str(total))
            projected_balance = balance_before - amount_dec

            # Negative balance policy:
            # - global flag `allow_negative_customer_wallet` ON  → legacy mode (unlimited negative)
            # - flag OFF (default new): customer wallet must not go negative,
            #   except admin can grant per-customer overdraft via `negative_credit_limit`
            allow_neg_global = SettingsService.get_bool(
                db, "allow_negative_customer_wallet", default=False,
            )
            if not allow_neg_global:
                max_overdraft = (
                    Decimal(str(customer.negative_credit_limit))
                    if customer.negative_credit_limit is not None
                    else Decimal("0")
                )
                if projected_balance < -max_overdraft:
                    raise BusinessRuleError(
                        code="EXCEEDS_NEGATIVE_CREDIT_LIMIT",
                        params={
                            "balance": float(balance_before),
                            "amount": float(total),
                            "maxOverdraft": float(max_overdraft),
                        },
                        message=(
                            f"ยอด wallet จะติดลบเกินขีดจำกัด. คงเหลือ ฿{float(balance_before):.2f}, "
                            f"ต้องชำระ ฿{total:.2f}, overdraft ที่อนุญาต ฿{float(max_overdraft):.2f}"
                        ),
                    )

            wallet.balance = projected_balance
            wallet_tx_data = {
                "wallet_id": wallet.id,
                "balance_before": balance_before,
                "balance_after": wallet.balance,
                "amount": amount_dec,
            }

        # Derive shop_id from first item if not explicitly passed
        effective_shop_id = shop_id
        if effective_shop_id is None and items:
            first_product = (
                db.query(ShopProduct)
                .filter(ShopProduct.id == items[0]["product_variant_id"])
                .first()
            )
            if first_product:
                effective_shop_id = first_product.shop_id

        # Polymorphic payer reference on the receipt — exactly one of customer_id /
        # payer_user_id / payer_department_id is set so audit/reporting stays clean.
        receipt_customer_id = customer_id if payer_kind == "customer" and not is_department_payment else None
        receipt_payer_user_id = payer_user_id if payer_kind == "user" else None
        receipt_payer_department_id = payer_department_id if is_department_payment else None

        receipt = Receipt(
            receipt_number=receipt_number,
            transaction_mode=TransactionMode(transaction_mode),
            payment_method=PaymentMethod(payment_method),
            customer_id=receipt_customer_id,
            payer_user_id=receipt_payer_user_id,
            payer_department_id=receipt_payer_department_id,
            requester_user_id=requester_user_id,
            shop_id=effective_shop_id,
            subtotal=subtotal,
            discount=bill_discount_amt,
            tax=0,
            total=total,
            notes=notes,
            created_by=user_id,
            status=ReceiptStatus.ACTIVE,
            edc_terminal_ref=(edc_terminal_ref or None),
            edc_approval_code=(edc_approval_code or None),
            edc_masked_card=(edc_masked_card or None),
        )
        db.add(receipt)
        db.flush()

        for ri in receipt_items:
            ri.receipt_id = receipt.id
            db.add(ri)

        # Record wallet deduction with receipt reference
        if wallet_tx_data:
            wtx = WalletTransaction(
                wallet_id=wallet_tx_data["wallet_id"],
                transaction_type=WalletTransactionType.DEDUCTION,
                amount=wallet_tx_data["amount"],
                balance_before=wallet_tx_data["balance_before"],
                balance_after=wallet_tx_data["balance_after"],
                reference_type="receipt",
                reference_id=receipt.id,
                description=f"Purchase at receipt {receipt.receipt_number}",
                created_by=user_id,
            )
            db.add(wtx)

        db.commit()
        db.refresh(receipt)

        # Audit log: sale created — must not block checkout on failure
        try:
            create_audit_log(
                db,
                entity_type="receipt",
                entity_id=receipt.id,
                entity_name=receipt.receipt_number,
                shop_id=effective_shop_id,
                action="CREATE",
                changes={"payment_method": payment_method, "total": float(total), "items": len(items)},
                user_id=user_id,
            )
            db.commit()
        except Exception as exc:
            _audit_logger.warning("audit log failed for receipt %s: %s", receipt.id, exc)
            db.rollback()  # restore session — receipt is already committed above

        return receipt

    # ── List receipts ────────────────────────────────────────────────────────

    @staticmethod
    def list_receipts(
        db: Session,
        *,
        q: Optional[str] = None,
        shop_id: Optional[str] = None,
        shop_ids: Optional[str] = None,
        transaction_mode: Optional[str] = None,
        requester_user_id: Optional[int] = None,
        page: int = 1,
        page_size: int = 50,
    ) -> List[Receipt]:
        query = (
            db.query(Receipt)
            .options(
                joinedload(Receipt.items).joinedload(ReceiptItem.product_variant),
                joinedload(Receipt.payer_user),
                joinedload(Receipt.payer_department),
                joinedload(Receipt.customer),
                joinedload(Receipt.requester),
            )
            .order_by(desc(Receipt.created_at))
        )
        if q:
            query = query.filter(
                Receipt.receipt_number.ilike(f"%{q}%")
            )
        if shop_id:
            query = query.filter(Receipt.shop_id == shop_id)
        elif shop_ids:
            ids = [s.strip() for s in shop_ids.split(",") if s.strip()]
            if ids:
                query = query.filter(Receipt.shop_id.in_(ids))
        if transaction_mode:
            query = query.filter(Receipt.transaction_mode == TransactionMode(transaction_mode))
        if requester_user_id:
            query = query.filter(Receipt.requester_user_id == requester_user_id)
        offset = (page - 1) * page_size
        return query.offset(offset).limit(page_size).all()

    # ── Get single receipt ───────────────────────────────────────────────────

    @staticmethod
    def get_receipt(db: Session, receipt_id: int) -> Optional[Receipt]:
        return (
            db.query(Receipt)
            .options(
                joinedload(Receipt.items).joinedload(ReceiptItem.product_variant),
                joinedload(Receipt.payer_user),
                joinedload(Receipt.payer_department),
                joinedload(Receipt.customer),
                joinedload(Receipt.requester),
            )
            .filter(Receipt.id == receipt_id)
            .first()
        )

    # ── Void receipt ─────────────────────────────────────────────────────────

    @staticmethod
    def void_receipt(
        db: Session,
        receipt_id: int,
        user_id: int,
        reason: Optional[str] = None,
    ) -> Receipt:
        receipt = (
            db.query(Receipt)
            .options(joinedload(Receipt.items).joinedload(ReceiptItem.product_variant))
            .filter(Receipt.id == receipt_id)
            .first()
        )
        if not receipt:
            raise ValueError(f"Receipt id={receipt_id} not found")
        if receipt.status == ReceiptStatus.VOIDED:
            raise ValueError("Receipt already voided")

        receipt.status = ReceiptStatus.VOIDED
        receipt.voided_at = datetime.utcnow()
        receipt.voided_by = user_id
        receipt.voided_reason = reason

        # Restore stock for each item
        for item in receipt.items:
            opts = item.options or {}
            # Bundle: restore all sub-SKUs that were deducted at checkout
            if opts.get("is_bundle") and opts.get("bundle_id"):
                bundle_items: list[BundleItem] = (
                    db.query(BundleItem)
                    .filter(BundleItem.bundle_id == opts["bundle_id"])
                    .all()
                )
                for bi in bundle_items:
                    sub_product: ShopProduct | None = (
                        db.query(ShopProduct).filter(ShopProduct.id == bi.product_id).first()
                    )
                    if not sub_product:
                        continue
                    restore_qty = bi.quantity * item.quantity
                    stock_before = sub_product.stock
                    sub_product.stock = stock_before + restore_qty
                    db.add(ShopMovement(
                        date=date.today(),
                        product_id=sub_product.id,
                        product_name=sub_product.name,
                        shop_id=sub_product.shop_id,
                        type=MovementType.void,
                        quantity=restore_qty,
                        stock_before=stock_before,
                        stock_after=sub_product.stock,
                        cost_per_unit=float(item.unit_price),
                        reference=receipt.receipt_number,
                        note=reason or "Voided receipt (bundle)",
                        created_by=user_id,
                    ))
                continue

            # Normal item
            product: ShopProduct = (
                db.query(ShopProduct)
                .filter(ShopProduct.id == item.product_variant_id)
                .first()
            )
            if not product:
                continue

            stock_before = product.stock
            product.stock = stock_before + item.quantity

            movement = ShopMovement(
                date=date.today(),
                product_id=product.id,
                product_name=product.name,
                shop_id=product.shop_id,
                type=MovementType.void,
                quantity=item.quantity,
                stock_before=stock_before,
                stock_after=product.stock,
                cost_per_unit=float(item.unit_price),
                reference=receipt.receipt_number,
                note=reason or "Voided receipt",
                created_by=user_id,
            )
            db.add(movement)

        # Refund wallet for any wallet-based payment (customer, user, or department)
        if receipt.payment_method in (PaymentMethod.WALLET, PaymentMethod.CARD_TAP):
            refund_wallet: Wallet | None = None
            if receipt.customer_id:
                refund_wallet = db.query(Wallet).filter(Wallet.customer_id == receipt.customer_id).first()
            elif receipt.payer_user_id:
                refund_wallet = db.query(Wallet).filter(Wallet.user_id == receipt.payer_user_id).first()
            elif receipt.payer_department_id:
                refund_wallet = db.query(Wallet).filter(Wallet.department_id == receipt.payer_department_id).first()

            if refund_wallet:
                balance_before = Decimal(str(refund_wallet.balance))
                amount_dec = Decimal(str(receipt.total))
                refund_wallet.balance = balance_before + amount_dec
                wtx = WalletTransaction(
                    wallet_id=refund_wallet.id,
                    transaction_type=WalletTransactionType.REFUND,
                    amount=amount_dec,
                    balance_before=balance_before,
                    balance_after=refund_wallet.balance,
                    reference_type="receipt_void",
                    reference_id=receipt.id,
                    description=f"Void refund for receipt {receipt.receipt_number}",
                    created_by=user_id,
                )
                db.add(wtx)

        db.commit()
        db.refresh(receipt)

        # Audit log: receipt voided
        try:
            create_audit_log(
                db,
                entity_type="receipt",
                entity_id=receipt.id,
                entity_name=receipt.receipt_number,
                shop_id=receipt.shop_id,
                action="VOID",
                changes={"reason": reason, "total": float(receipt.total)},
                user_id=user_id,
            )
            db.commit()
        except Exception as exc:
            _audit_logger.warning("audit log failed for void receipt %s: %s", receipt.id, exc)
            db.rollback()

        return receipt
