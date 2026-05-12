"""
Inventory Service
Implements avg_cost recalculation and FIFO lot management.
Mirrors the business logic in src/pages/Inventory.tsx exactly.
"""
from __future__ import annotations

import time
from datetime import date, datetime
from typing import List, Optional
from sqlalchemy.orm import Session

from app.models.shop import Shop, ShopProduct, ShopMovement, MovementType
from app.models.fifo_lot import FifoLot


# ── Pure calculation helpers (mirrored from Inventory.tsx) ────────────────────

def calc_new_avg_cost(
    current_stock: int,
    current_avg_cost: float,
    new_qty: int,
    new_cost_per_unit: float,
) -> float:
    """Weighted average cost formula for avg_cost shops."""
    total_current_value = max(current_stock, 0) * current_avg_cost
    total_qty = max(current_stock, 0) + new_qty
    if total_qty == 0:
        return new_cost_per_unit
    return (total_current_value + new_qty * new_cost_per_unit) / total_qty


def calc_fifo_avg_cost(lots: List[FifoLot]) -> float:
    """Weighted average of remaining FIFO lots (displayed avg cost)."""
    total_qty = sum(float(l.qty_remaining) for l in lots)
    if total_qty == 0:
        return 0.0
    return sum(float(l.qty_remaining) * float(l.cost_per_unit) for l in lots) / total_qty


def _deduct_fifo_lots_in_memory(
    lots: List[FifoLot],
    qty: int,
    product_id: int,
    shop_id: str,
) -> List[dict]:
    """
    Deduct qty from oldest lots first.
    Returns a list of dicts representing the updated lot state.
    If all lots are exhausted and qty remains (negative stock),
    appends a phantom lot with negative qty_remaining.
    """
    sorted_lots = sorted(lots, key=lambda l: str(l.date))
    remaining = abs(qty)
    result = []

    for lot in sorted_lots:
        if remaining <= 0:
            result.append({
                "id": lot.id,
                "product_id": lot.product_id,
                "shop_id": lot.shop_id,
                "date": lot.date,
                "qty_remaining": float(lot.qty_remaining),
                "cost_per_unit": float(lot.cost_per_unit),
            })
            continue
        deduct = min(float(lot.qty_remaining), remaining)
        remaining -= deduct
        new_qty = float(lot.qty_remaining) - deduct
        if new_qty > 0:
            result.append({
                "id": lot.id,
                "product_id": lot.product_id,
                "shop_id": lot.shop_id,
                "date": lot.date,
                "qty_remaining": new_qty,
                "cost_per_unit": float(lot.cost_per_unit),
            })

    # Phantom lot for negative stock
    if remaining > 0:
        latest_lot = sorted_lots[-1] if sorted_lots else None
        fallback_cost = float(latest_lot.cost_per_unit) if latest_lot else 0.0
        result.append({
            "id": f"phantom-{int(time.time() * 1000)}",
            "product_id": product_id,
            "shop_id": shop_id,
            "date": date.today(),
            "qty_remaining": -remaining,
            "cost_per_unit": fallback_cost,
        })

    return result


# ── InventoryService ──────────────────────────────────────────────────────────

class InventoryService:

    # ── Receive stock ─────────────────────────────────────────────────────────

    @staticmethod
    def receive_stock(
        db: Session,
        shop: Shop,
        product: ShopProduct,
        qty: int,
        cost_per_unit: float,
        reference: Optional[str] = None,
        note: Optional[str] = None,
        user_id: Optional[int] = None,
    ) -> ShopProduct:
        """
        Receive stock into a shop product.
        - avg_cost shops: recalculate weighted average cost.
        - fifo shops: append a new lot.
        Records a ShopMovement row.
        """
        stock_before = product.stock

        if shop.shop_type.value == "fifo":
            # Append new lot
            new_lot = FifoLot(
                id=f"recv-{int(time.time() * 1000)}-{product.id}",
                product_id=product.id,
                shop_id=shop.id,
                date=date.today(),
                qty_remaining=qty,
                cost_per_unit=cost_per_unit,
            )
            db.add(new_lot)
            db.flush()  # get lot into session

            # Recompute displayed avg from all lots
            all_lots = (
                db.query(FifoLot)
                .filter(FifoLot.product_id == product.id)
                .all()
            )
            all_lots.append(new_lot)
            new_avg = calc_fifo_avg_cost(all_lots)
            product.stock = stock_before + qty
            product.avg_cost = round(new_avg, 4)
        else:
            # avg_cost recalculation
            new_avg = calc_new_avg_cost(product.stock, float(product.avg_cost), qty, cost_per_unit)
            product.stock = stock_before + qty
            product.avg_cost = round(new_avg, 4)

        # Record movement
        movement = ShopMovement(
            date=date.today(),
            product_id=product.id,
            product_name=product.name,
            shop_id=shop.id,
            type=MovementType.receive,
            quantity=qty,
            stock_before=stock_before,
            stock_after=product.stock,
            cost_per_unit=cost_per_unit,
            reference=reference,
            note=note,
            created_by=user_id,
        )
        db.add(movement)
        return product

    # ── Adjust stock ──────────────────────────────────────────────────────────

    @staticmethod
    def adjust_stock(
        db: Session,
        shop: Shop,
        product: ShopProduct,
        delta: int,
        reason: str,
        cost_per_unit: Optional[float] = None,
        user_id: Optional[int] = None,
    ) -> ShopProduct:
        """
        Manual stock adjustment.
        - FIFO negative: deduct from oldest lots (phantom lot if needed).
        - FIFO positive: append new lot using cost_per_unit or last lot's cost.
        - avg_cost: update stock directly; recalculate avg only on positive delta.
        """
        stock_before = product.stock

        if shop.shop_type.value == "fifo":
            existing_lots = (
                db.query(FifoLot)
                .filter(FifoLot.product_id == product.id)
                .all()
            )

            if delta < 0:
                new_lot_dicts = _deduct_fifo_lots_in_memory(
                    existing_lots, abs(delta), product.id, shop.id
                )
                # Delete old lots and re-insert updated ones
                db.query(FifoLot).filter(FifoLot.product_id == product.id).delete()
                db.flush()
                for ld in new_lot_dicts:
                    db.add(FifoLot(**ld))
            else:
                # Determine cost: user input → last lot cost → current avgCost
                if cost_per_unit is not None and cost_per_unit >= 0:
                    lot_cost = cost_per_unit
                elif existing_lots:
                    sorted_lots = sorted(existing_lots, key=lambda l: str(l.date), reverse=True)
                    lot_cost = float(sorted_lots[0].cost_per_unit)
                else:
                    lot_cost = float(product.avg_cost)

                new_lot = FifoLot(
                    id=f"adj-{int(time.time() * 1000)}",
                    product_id=product.id,
                    shop_id=shop.id,
                    date=date.today(),
                    qty_remaining=delta,
                    cost_per_unit=lot_cost,
                )
                db.add(new_lot)

            db.flush()
            all_lots = db.query(FifoLot).filter(FifoLot.product_id == product.id).all()
            product.stock = int(sum(float(l.qty_remaining) for l in all_lots))
            product.avg_cost = round(calc_fifo_avg_cost(all_lots), 4)
        else:
            product.stock = stock_before + delta
            if delta > 0 and cost_per_unit is not None:
                new_avg = calc_new_avg_cost(
                    stock_before, float(product.avg_cost), delta, cost_per_unit
                )
                product.avg_cost = round(new_avg, 4)

        movement = ShopMovement(
            date=date.today(),
            product_id=product.id,
            product_name=product.name,
            shop_id=shop.id,
            type=MovementType.adjustment,
            quantity=delta,
            stock_before=stock_before,
            stock_after=product.stock,
            cost_per_unit=cost_per_unit,
            note=reason,
            created_by=user_id,
        )
        db.add(movement)
        return product
