"""
Spending Groups API — CRUD + usage-today endpoints.

RBAC:
  - CRUD (list/get/create/update/delete): admin only (is_superuser)
  - usage-today/{id}: any authenticated user (POS roles use this for the chip)
  - usage-today/by-child: parent or admin (scoped to linked children for parents)
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_active_user, get_current_user
from app.models.user import User
from app.models.shop import Shop
from app.models.spending_group import SpendingGroup
from app.schemas.spending_group import (
    SpendingGroupCreate,
    SpendingGroupUpdate,
    SpendingGroupResponse,
    SpendingGroupUsageResponse,
)
from app.services.spending_limit_service import compute_spent_today

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_response(group: SpendingGroup, db: Session) -> SpendingGroupResponse:
    """Attach computed linked_shop_count to the ORM row."""
    count = db.query(Shop).filter(Shop.spending_group_id == group.id).count()
    data = SpendingGroupResponse.model_validate(group)
    data.linked_shop_count = count
    return data


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[SpendingGroupResponse])
def list_spending_groups(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
):
    """List all spending groups. Any authenticated user can read this."""
    groups = db.query(SpendingGroup).order_by(SpendingGroup.id).all()
    return [_to_response(g, db) for g in groups]


@router.post("/", response_model=SpendingGroupResponse, status_code=status.HTTP_201_CREATED)
def create_spending_group(
    body: SpendingGroupCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Create a new spending group. Admin only."""
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Admin only")
    existing = db.query(SpendingGroup).filter(SpendingGroup.code == body.code).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail={"code": "DUPLICATE_GROUP_CODE", "message": f"A group with code '{body.code}' already exists"},
        )
    group = SpendingGroup(**body.model_dump())
    db.add(group)
    db.commit()
    db.refresh(group)
    return _to_response(group, db)


# NOTE: /usage-today/by-child must be registered BEFORE /{id} so FastAPI
# doesn't interpret "usage-today" as an integer id path segment.
@router.get("/usage-today/by-child", response_model=List[SpendingGroupUsageResponse])
def usage_today_by_child(
    customer_id: int = Query(..., description="Customer (child) ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Return today's usage across all active groups for a given child customer.

    Parents can only query their own linked children.
    Admins can query any child.
    """
    if not current_user.is_superuser:
        # Verify parent → child link
        from app.models.parent_child_link import ParentChildLink
        link = (
            db.query(ParentChildLink)
            .filter(
                ParentChildLink.parent_user_id == current_user.id,
                ParentChildLink.child_customer_id == customer_id,
            )
            .first()
        )
        if not link:
            raise HTTPException(
                status_code=403,
                detail="You are not linked to this child",
            )

    active_groups = (
        db.query(SpendingGroup)
        .filter(SpendingGroup.is_active == True)
        .order_by(SpendingGroup.id)
        .all()
    )

    results = []
    for group in active_groups:
        spent = compute_spent_today(
            db,
            payer_customer_id=customer_id,
            spending_group_id=group.id,
        )
        limit = float(group.daily_limit)
        results.append(
            SpendingGroupUsageResponse(
                spending_group_id=group.id,
                code=group.code,
                name_en=group.name_en,
                name_th=group.name_th,
                daily_limit=limit,
                spent_today=float(spent),
                remaining=max(0.0, limit - float(spent)),
            )
        )
    return results


@router.get("/{group_id}", response_model=SpendingGroupResponse)
def get_spending_group(
    group_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
):
    """Get a single spending group by ID."""
    group = db.query(SpendingGroup).filter(SpendingGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Spending group not found")
    return _to_response(group, db)


@router.patch("/{group_id}", response_model=SpendingGroupResponse)
def update_spending_group(
    group_id: int,
    body: SpendingGroupUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Update a spending group. Admin only."""
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Admin only")
    group = db.query(SpendingGroup).filter(SpendingGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Spending group not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(group, field, value)
    db.commit()
    db.refresh(group)
    return _to_response(group, db)


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_spending_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Delete a spending group. Admin only.

    Returns 409 if any shops are still linked, with a `blocking_shops` list.
    """
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Admin only")
    group = db.query(SpendingGroup).filter(SpendingGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Spending group not found")

    blocking = (
        db.query(Shop)
        .filter(Shop.spending_group_id == group_id)
        .all()
    )
    if blocking:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "GROUP_HAS_LINKED_SHOPS",
                "message": f"Cannot delete — {len(blocking)} shop(s) still linked. Reassign them first.",
                "blocking_shops": [{"id": s.id, "name": s.name} for s in blocking],
            },
        )

    db.delete(group)
    db.commit()


@router.get("/{group_id}/usage-today", response_model=SpendingGroupUsageResponse)
def usage_today(
    group_id: int,
    payer_customer_id: Optional[int] = Query(None),
    payer_user_id: Optional[int] = Query(None),
    payer_department_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
):
    """Return today's spend / remaining for one group + one payer.

    Used by POS "Today's remaining" chip after customer scan and after checkout.
    Any authenticated POS role may call this.
    """
    group = db.query(SpendingGroup).filter(SpendingGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Spending group not found")

    spent = compute_spent_today(
        db,
        payer_customer_id=payer_customer_id,
        payer_user_id=payer_user_id,
        payer_department_id=payer_department_id,
        spending_group_id=group_id,
    )
    limit = float(group.daily_limit)
    return SpendingGroupUsageResponse(
        spending_group_id=group.id,
        code=group.code,
        name_en=group.name_en,
        name_th=group.name_th,
        daily_limit=limit,
        spent_today=float(spent),
        remaining=max(0.0, limit - float(spent)),
    )
