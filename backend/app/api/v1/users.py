"""
Shop-scoped User Management API (Sitemap v2).

GET    /api/v1/users           list users (admin / shop-manager scope)
GET    /api/v1/users/{id}      fetch single user (admin / self / same-shop manager)
POST   /api/v1/users           create user (admin / shop manager)
PATCH  /api/v1/users/{id}      update user (admin / same-shop manager)
DELETE /api/v1/users/{id}      delete user (admin only)

Permission summary
------------------
* admin / is_superuser → may manage any user across all shops.
* manager → may only act on users inside their own `shop_id`; may only
  create cashier-role users and may only assign shop_id == own shop.
* everyone else (cashier, parent, student, …) → 403 on these endpoints.

Manager-created users are always saved with `external_id = None` so the
PowerSchool sync will not clobber them.
"""
from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from pydantic import BaseModel

from app.api.deps import get_current_user, require_role
from app.core.database import get_db
from app.models.customer import Customer
from app.models.user import User
from app.models.wallet import Wallet
from app.schemas.user import (
    UserCreate,
    UserListResponse,
    UserResponse,
    UserUpdate,
)
from app.services.user_service import UserService
from app.services.wallet_service import WalletService

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Permission helpers ───────────────────────────────────────────────────────

_ADMIN_ROLES = {"admin"}
_MANAGER_ROLES = {"manager"}


def _is_admin(user: User) -> bool:
    return bool(user.is_superuser) or user.role == "admin"


def _is_manager(user: User) -> bool:
    # A manager is anyone whose primary role is "manager" and not an admin.
    return user.role == "manager" and not _is_admin(user)


def _require_admin_or_manager(current_user: User) -> None:
    if not (_is_admin(current_user) or _is_manager(current_user)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins or shop managers may manage users",
        )


# ── List ─────────────────────────────────────────────────────────────────────

@router.get("/", response_model=UserListResponse)
def list_users(
    q: Optional[str] = Query(None, description="Search username/full_name/email"),
    shop_id: Optional[str] = Query(None, description="Filter by shop_id"),
    role: Optional[str] = Query(None, description="Filter by role"),
    unassigned: bool = Query(False, description="Return only users without a shop_id"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_or_manager(current_user)

    # Manager: force the scope to own shop. "unassigned" for another shop is
    # not allowed — managers cannot see unassigned users.
    if _is_manager(current_user):
        if not current_user.shop_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Manager has no shop assignment",
            )
        shop_id = current_user.shop_id
        unassigned = False

    items, total = UserService.list_users(
        db,
        q=q,
        shop_id=shop_id,
        role=role,
        unassigned=unassigned,
        page=page,
        page_size=page_size,
    )
    return UserListResponse(items=items, total=total)


# ── POS-side payer lookup ────────────────────────────────────────────────────

class UserPayerLookupResponse(BaseModel):
    """Compact view of a user + their personal wallet for POS register lookup."""
    user_id: int
    username: str
    full_name: str
    role: str
    photo_url: Optional[str] = None
    wallet_id: int
    wallet_balance: float
    is_active: bool
    # Department association (if user belongs to a department — enables auto-fill in dept payment)
    department_id: Optional[int] = None
    department_code: Optional[str] = None
    department_name: Optional[str] = None


@router.get("/by-username/{username}", response_model=UserPayerLookupResponse)
def get_user_payer_by_username(
    username: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role("cashier", "manager", "admin", "kitchen", "staff")
    ),
):
    """Resolve a parent/staff user by username for POS wallet payment.

    Returns the user's personal wallet (auto-created if missing) so the cashier
    can preview balance before charging. 404 if no such user.
    """
    target = (
        db.query(User)
        .filter(User.username == username)
        .first()
    )
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลในระบบ")
    if not target.is_active:
        raise HTTPException(status_code=400, detail="User is inactive")

    w = WalletService.ensure_wallet_for_user(db, target.id)
    db.commit()
    db.refresh(w)

    return UserPayerLookupResponse(
        user_id=target.id,
        username=target.username,
        full_name=target.full_name,
        role=target.role or "",
        photo_url=target.photo_url,
        wallet_id=w.id,
        wallet_balance=float(w.balance),
        is_active=bool(target.is_active),
        department_id=target.department_id,
        department_code=target.department.department_code if target.department else None,
        department_name=target.department.department_name if target.department else None,
    )


@router.get("/by-card/{uid}", response_model=UserPayerLookupResponse)
def get_user_payer_by_card(
    uid: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role("cashier", "manager", "admin", "kitchen", "staff")
    ),
):
    """Resolve a parent/staff user by NFC card UID for POS wallet payment.

    Mirrors get_user_payer_by_username — same response shape, same role guard,
    differs only in the lookup field (card_uid instead of username).
    """
    target = db.query(User).filter(User.card_uid.ilike(uid)).first()
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบบัตรนี้ในระบบ")
    if not target.is_active:
        raise HTTPException(status_code=400, detail="User is inactive")

    w = WalletService.ensure_wallet_for_user(db, target.id)
    db.commit()
    db.refresh(w)

    return UserPayerLookupResponse(
        user_id=target.id,
        username=target.username,
        full_name=target.full_name,
        role=target.role or "",
        photo_url=target.photo_url,
        wallet_id=w.id,
        wallet_balance=float(w.balance),
        is_active=bool(target.is_active),
        department_id=target.department_id,
        department_code=target.department.department_code if target.department else None,
        department_name=target.department.department_name if target.department else None,
    )


# ── Family lookup (POS: search by employee code or family code) ──────────────

class FamilyMemberLookup(BaseModel):
    entity_type: str  # "user" or "customer"
    id: int
    name: str
    role: Optional[str] = None
    grade: Optional[str] = None
    photo_url: Optional[str] = None
    allergies: Optional[str] = None
    card_frozen: bool = False
    wallet_id: Optional[int] = None
    wallet_balance: Optional[float] = None
    customer_code: Optional[str] = None
    student_code: Optional[str] = None
    username: Optional[str] = None


class FamilyLookupResponse(BaseModel):
    family_code: Optional[str]
    members: List[FamilyMemberLookup]


def _customer_to_member(db: Session, c: Customer) -> FamilyMemberLookup:
    WalletService.ensure_wallet_for_customer(db, c.id)
    wallet = db.query(Wallet).filter(Wallet.customer_id == c.id).first()
    return FamilyMemberLookup(
        entity_type="customer",
        id=c.id,
        name=c.name,
        role="student",
        grade=c.grade,
        photo_url=c.photo_url,
        allergies=c.allergies,
        card_frozen=bool(c.card_frozen),
        wallet_id=wallet.id if wallet else None,
        wallet_balance=float(wallet.balance) if wallet else None,
        customer_code=c.customer_code,
        student_code=c.student_code,
    )


def _user_to_member(db: Session, u: User) -> FamilyMemberLookup:
    w = WalletService.ensure_wallet_for_user(db, u.id)
    db.commit()
    db.refresh(w)
    return FamilyMemberLookup(
        entity_type="user",
        id=u.id,
        name=u.full_name or u.username,
        role=u.role,
        photo_url=u.photo_url,
        wallet_id=w.id,
        wallet_balance=float(w.balance),
        username=u.username,
    )


@router.get("/family-lookup", response_model=FamilyLookupResponse)
def family_lookup(
    q: str = Query(..., description="Employee username or family code"),
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role("cashier", "manager", "admin", "kitchen", "staff")
    ),
):
    """Resolve a user (by username) or family group (by family_code) for POS use.

    Returns the matched user + all family members (spouse + children) with
    wallet balances. Used when a customer does not have their card.
    """
    q = q.strip()
    members: List[FamilyMemberLookup] = []
    family_code: Optional[str] = None

    # Try by username first
    user = db.query(User).filter(User.username == q).first()

    if user:
        family_code = user.family_code
        members.append(_user_to_member(db, user))
        if family_code:
            # Add other users in same family (spouse/partner)
            for u in db.query(User).filter(
                User.family_code == family_code, User.id != user.id
            ).all():
                members.append(_user_to_member(db, u))
            # Add children (customers with same family_code)
            for c in db.query(Customer).filter(
                Customer.family_code == family_code, Customer.is_active.is_(True)
            ).all():
                members.append(_customer_to_member(db, c))
        db.commit()
        return FamilyLookupResponse(family_code=family_code, members=members)

    # Try by family_code directly
    family_users = db.query(User).filter(User.family_code == q).all()
    family_customers = db.query(Customer).filter(
        Customer.family_code == q, Customer.is_active.is_(True)
    ).all()
    if family_users or family_customers:
        family_code = q
        for u in family_users:
            members.append(_user_to_member(db, u))
        for c in family_customers:
            members.append(_customer_to_member(db, c))
        db.commit()
        return FamilyLookupResponse(family_code=family_code, members=members)

    raise HTTPException(status_code=404, detail="ไม่พบข้อมูล: ลองใช้รหัสพนักงานหรือรหัสครอบครัว")


# ── Detail ───────────────────────────────────────────────────────────────────

@router.get("/{user_id}", response_model=UserResponse)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user = UserService.get_user(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลในระบบ")

    # Admins may always view. A user may always view themselves. A manager may
    # view any user in their own shop. Everyone else → 403.
    if _is_admin(current_user):
        pass
    elif current_user.id == user.id:
        pass
    elif _is_manager(current_user):
        if not current_user.shop_id or user.shop_id != current_user.shop_id:
            raise HTTPException(status_code=403, detail="Not authorized")
    else:
        raise HTTPException(status_code=403, detail="Not authorized")

    return UserService._user_to_response(user)


# ── Create ───────────────────────────────────────────────────────────────────

@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_or_manager(current_user)

    if _is_manager(current_user):
        # Manager-only rules.
        if not current_user.shop_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Manager has no shop assignment",
            )
        if payload.shop_id != current_user.shop_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Manager can only create users inside their own shop",
            )
        if payload.role != "cashier":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Manager may only create cashier users",
            )

    try:
        return UserService.create_user(db, payload, created_by=current_user)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


# ── Update ───────────────────────────────────────────────────────────────────

@router.patch("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_or_manager(current_user)

    target = UserService.get_user(db, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลในระบบ")

    if _is_manager(current_user):
        if not current_user.shop_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Manager has no shop assignment",
            )
        # Target must belong to manager's shop.
        if target.shop_id != current_user.shop_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Manager can only manage users inside their own shop",
            )
        # Manager may only move the target to own shop or unassign (null).
        if "shop_id" in payload.model_fields_set:
            new_shop = payload.shop_id
            if new_shop not in (None, current_user.shop_id):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Manager may only assign users to their own shop (or unassign)",
                )
        # Manager may not escalate role to admin or manager.
        if payload.role is not None and payload.role in ("admin", "manager"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Manager may not assign admin or manager roles",
            )

    try:
        return UserService.update_user(db, user_id, payload, actor=current_user)
    except LookupError:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลในระบบ")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Delete ───────────────────────────────────────────────────────────────────

@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")

    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    try:
        UserService.delete_user(db, user_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลในระบบ")
    return None
