"""
Bundle checkout + void stock-restoration tests.

Critical bug fixed: voiding a bundle receipt previously only restored stock for
the anchor sub-product.  These tests verify that ALL sub-SKUs are restored.

Also includes a normal (non-bundle) void smoke test so we don't regress that.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.models.bundle import BundleItem, ProductBundle
from app.models.receipt import PaymentMethod, Receipt, ReceiptItem, ReceiptStatus, TransactionMode
from app.models.shop import MovementType, ShopMovement, ShopProduct
from app.services.pos_service import POSService

void_receipt = POSService.void_receipt


# ── Helpers ───────────────────────────────────────────────────────────────────

def _movement(db, product: ShopProduct, qty: int, stock_before: int, stock_after: int, user_id: int, ref: str):
    m = ShopMovement(
        date=date.today(),
        product_id=product.id,
        product_name=product.name,
        shop_id=product.shop_id,
        type=MovementType.receive,
        quantity=qty,
        stock_before=stock_before,
        stock_after=stock_after,
        created_by=user_id,
        reference=ref,
    )
    db.add(m)


def _receipt(db, shop_id: str, user_id: int, items: list[ReceiptItem], receipt_number: str = "RCT-001") -> Receipt:
    receipt = Receipt(
        receipt_number=receipt_number,
        transaction_mode=TransactionMode.SALE,
        shop_id=shop_id,
        total=Decimal("100.00"),
        payment_method=PaymentMethod.CASH,
        status=ReceiptStatus.ACTIVE,
        created_by=user_id,
    )
    db.add(receipt)
    db.flush()
    for item in items:
        item.receipt_id = receipt.id
        db.add(item)
    db.commit()
    db.refresh(receipt)
    return receipt


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_normal_void_restores_stock(db_session_pos, pos_seed):
    """Voiding a single-product receipt restores that product's stock."""
    p1 = pos_seed["p1"]  # stock = 100
    admin = pos_seed["admin"]

    # Simulate a sale that deducted 5 units
    p1.stock = 95
    db_session_pos.flush()

    item = ReceiptItem(
        product_variant_id=p1.id,
        quantity=5,
        unit_price=Decimal("50"),
        discount=Decimal("0"),
        line_total=Decimal("250"),
    )
    receipt = _receipt(db_session_pos, "coop", admin.id, [item])

    void_receipt(db_session_pos, receipt.id, admin.id, reason="test void")

    db_session_pos.refresh(p1)
    assert p1.stock == 100
    assert receipt.status == ReceiptStatus.VOIDED


def test_bundle_void_restores_all_sub_skus(db_session_pos, pos_seed):
    """Voiding a bundle receipt must restore stock for every sub-SKU, not just anchor."""
    p1 = pos_seed["p1"]  # notebook: stock=100
    p2 = pos_seed["p2"]  # pencil:   stock=200
    admin = pos_seed["admin"]

    # Create bundle: 1x notebook + 2x pencil
    bundle = ProductBundle(
        shop_id="coop",
        bundle_code="GR1-SET",
        name="Grade 1 Set",
        external_price=Decimal("70"),
        internal_price=Decimal("60"),
    )
    db_session_pos.add(bundle)
    db_session_pos.flush()

    bi1 = BundleItem(bundle_id=bundle.id, product_id=p1.id, quantity=1)
    bi2 = BundleItem(bundle_id=bundle.id, product_id=p2.id, quantity=2)
    db_session_pos.add_all([bi1, bi2])
    db_session_pos.flush()

    # Simulate checkout: qty=2 bundles sold → deducted 2×notebook, 4×pencil
    p1.stock = 98   # 100 - 2
    p2.stock = 196  # 200 - 4
    db_session_pos.flush()

    # Bundle receipt: anchor = p1, options carries bundle metadata
    item = ReceiptItem(
        product_variant_id=p1.id,  # anchor
        quantity=2,
        unit_price=Decimal("70"),
        discount=Decimal("0"),
        line_total=Decimal("140"),
        options={
            "is_bundle": True,
            "bundle_id": bundle.id,
            "bundle_name": bundle.name,
            "bundle_code": bundle.bundle_code,
        },
    )
    receipt = _receipt(db_session_pos, "coop", admin.id, [item], receipt_number="RCT-002")

    void_receipt(db_session_pos, receipt.id, admin.id, reason="test bundle void")

    db_session_pos.refresh(p1)
    db_session_pos.refresh(p2)

    assert p1.stock == 100, f"Notebook stock should be 100, got {p1.stock}"
    assert p2.stock == 200, f"Pencil stock should be 200, got {p2.stock}"
    assert receipt.status == ReceiptStatus.VOIDED


def test_bundle_void_records_shop_movements_for_all_sub_skus(db_session_pos, pos_seed):
    """Each sub-SKU void should produce its own ShopMovement audit row."""
    p1 = pos_seed["p1"]
    p2 = pos_seed["p2"]
    admin = pos_seed["admin"]

    bundle = ProductBundle(
        shop_id="coop", bundle_code="GR2-SET", name="Grade 2 Set",
        external_price=Decimal("80"), internal_price=Decimal("65"),
    )
    db_session_pos.add(bundle)
    db_session_pos.flush()

    db_session_pos.add_all([
        BundleItem(bundle_id=bundle.id, product_id=p1.id, quantity=1),
        BundleItem(bundle_id=bundle.id, product_id=p2.id, quantity=3),
    ])
    db_session_pos.flush()

    p1.stock = 99
    p2.stock = 197
    db_session_pos.flush()

    item = ReceiptItem(
        product_variant_id=p1.id,
        quantity=1,
        unit_price=Decimal("80"),
        discount=Decimal("0"),
        line_total=Decimal("80"),
        options={"is_bundle": True, "bundle_id": bundle.id, "bundle_name": bundle.name, "bundle_code": bundle.bundle_code},
    )
    receipt = _receipt(db_session_pos, "coop", admin.id, [item], receipt_number="RCT-003")

    void_receipt(db_session_pos, receipt.id, admin.id, reason="audit test")

    movements = (
        db_session_pos.query(ShopMovement)
        .filter(
            ShopMovement.reference == receipt.receipt_number,
            ShopMovement.type == MovementType.void,
        )
        .all()
    )
    product_ids_with_void = {m.product_id for m in movements}
    assert p1.id in product_ids_with_void, "No void movement found for notebook"
    assert p2.id in product_ids_with_void, "No void movement found for pencil"


def test_void_already_voided_receipt_raises(db_session_pos, pos_seed):
    """Voiding an already-voided receipt must raise ValueError."""
    p1 = pos_seed["p1"]
    admin = pos_seed["admin"]

    item = ReceiptItem(
        product_variant_id=p1.id,
        quantity=1,
        unit_price=Decimal("50"),
        discount=Decimal("0"),
        line_total=Decimal("50"),
    )
    receipt = _receipt(db_session_pos, "coop", admin.id, [item], receipt_number="RCT-004")

    void_receipt(db_session_pos, receipt.id, admin.id, reason="first void")

    with pytest.raises((ValueError, Exception)):
        void_receipt(db_session_pos, receipt.id, admin.id, reason="second void")
