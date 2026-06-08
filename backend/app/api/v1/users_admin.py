"""
Admin User Management API (Phase 3.5 + 3.5b PS alignment).

GET    /api/v1/users-admin/                          list users w/ filter + search
GET    /api/v1/users-admin/{id}                      user detail + family + identity history
PATCH  /api/v1/users-admin/{id}                      update (auto-logs external_id change)
GET    /api/v1/users-admin/{id}/family               resolve family by family_code
POST   /api/v1/users-admin/{id}/link-student         admin manual parent-child link
DELETE /api/v1/users-admin/{id}/link-student/{cid}   admin manual unlink
GET    /api/v1/users-admin/students                  list Customer rows with student_code (for link picker)
PATCH  /api/v1/users-admin/family-profile/{fcode}    update notification_emails/login_ids per family
"""
import logging
from datetime import datetime
from typing import Dict, List, Optional, Set, Tuple

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps import require_role, get_current_user
from app.core.database import get_db
from app.models.customer import Customer
from app.models.family_profile import FamilyProfile
from app.models.identity_mapping import IdentityMapping
from app.models.parent_child_link import ParentChildLink
from app.models.shop import Shop
from app.models.user import User
from app.schemas.user_admin import (
    FamilyMember,
    FamilyProfileItem,
    FamilyProfileUpdate,
    IdentityHistoryItem,
    LinkStudentRequest,
    LinkStudentResponse,
    UserDetail,
    UserListItem,
    UserUpdate,
)
from app.services.wallet_service import WalletService

logger = logging.getLogger(__name__)
router = APIRouter()


# ── helpers ──────────────────────────────────────────────────────────────────


def _families_with_children(db: Session, family_codes: Set[str]) -> Set[str]:
    """Return the subset of family_codes that have at least one student."""
    if not family_codes:
        return set()
    rows = (
        db.query(Customer.family_code)
        .filter(
            Customer.family_code.in_(family_codes),
            Customer.student_code.isnot(None),
        )
        .distinct()
        .all()
    )
    return {r[0] for r in rows if r[0]}


def _shop_name_map(db: Session) -> Dict[str, str]:
    """Cache shop id → name for response enrichment."""
    return {s.id: s.name for s in db.query(Shop).all()}


def _user_to_list_item(
    u: User, has_children: bool = False, shop_names: Optional[Dict[str, str]] = None
) -> UserListItem:
    shop_id = getattr(u, "shop_id", None)
    return UserListItem(
        id=u.id,
        username=u.username,
        email=u.email,
        full_name=u.full_name,
        role=u.role,
        external_id=u.external_id,
        family_code=u.family_code,
        photo_url=u.photo_url,
        status=u.status or ("active" if u.is_active else "inactive"),
        is_active=bool(u.is_active),
        last_synced_at=u.last_synced_at,
        allergies=u.allergies,
        customer_type=u.customer_type,
        staff_type=getattr(u, "staff_type", None),
        ps_department=getattr(u, "ps_department", None),
        card_uid=u.card_uid,
        has_children=has_children,
        shop_id=shop_id,
        shop_name=(shop_names or {}).get(shop_id) if shop_id else None,
    )


def _parent_rank_map(db: Session, family_code: Optional[str]) -> Dict[int, str]:
    """Return {parent_user_id: rank} for all main/secondary links in this family."""
    if not family_code:
        return {}
    # Any link where the child customer belongs to this family → parent_rank
    rows = (
        db.query(ParentChildLink.parent_user_id, ParentChildLink.parent_rank)
        .join(Customer, Customer.id == ParentChildLink.child_customer_id)
        .filter(Customer.family_code == family_code)
        .all()
    )
    out: Dict[int, str] = {}
    for pid, rank in rows:
        if rank and pid not in out:
            out[pid] = rank
    return out


def _resolve_family(db: Session, family_code: Optional[str]) -> List[FamilyMember]:
    if not family_code:
        return []
    rank_map = _parent_rank_map(db, family_code)
    members: List[FamilyMember] = []
    for u in db.query(User).filter(User.family_code == family_code).all():
        members.append(FamilyMember(
            entity_type="user",
            id=u.id,
            name=u.full_name,
            role=u.role,
            external_id=u.external_id,
            photo_url=u.photo_url,
            customer_type=u.customer_type,
            card_uid=u.card_uid,
            parent_rank=rank_map.get(u.id),
        ))
    for c in db.query(Customer).filter(Customer.family_code == family_code).all():
        members.append(FamilyMember(
            entity_type="customer",
            id=c.id,
            name=c.name,
            role="student",
            external_id=c.external_id,
            grade=c.grade,
            photo_url=c.photo_url,
            student_code=c.student_code,
            customer_code=c.customer_code,
            customer_type=c.customer_type,
            school_type=c.school_type,
            card_uid=c.card_uid,
        ))
    return members


def _identity_history(db: Session, entity_type: str, entity_id: int) -> List[IdentityHistoryItem]:
    rows = (
        db.query(IdentityMapping)
        .filter(IdentityMapping.entity_type == entity_type, IdentityMapping.entity_id == entity_id)
        .order_by(IdentityMapping.changed_at.desc())
        .all()
    )
    out: List[IdentityHistoryItem] = []
    for r in rows:
        name = None
        if r.changed_by:
            u = db.query(User).filter(User.id == r.changed_by).first()
            name = u.full_name if u else None
        out.append(IdentityHistoryItem(
            id=r.id,
            entity_type=r.entity_type,
            old_external_id=r.old_external_id,
            new_external_id=r.new_external_id,
            reason=r.reason,
            changed_by_name=name,
            changed_at=r.changed_at,
        ))
    return out


def _family_profile(db: Session, family_code: Optional[str]) -> Optional[FamilyProfileItem]:
    if not family_code:
        return None
    fp = db.query(FamilyProfile).filter(FamilyProfile.family_code == family_code).first()
    if not fp:
        return None
    return FamilyProfileItem(
        family_code=fp.family_code,
        notification_emails=list(fp.notification_emails or []),
        login_ids=list(fp.login_ids or []),
        last_synced_at=fp.last_synced_at,
    )


def _build_detail(db: Session, u: User) -> UserDetail:
    fcode = u.family_code
    has_kids = bool(fcode and _families_with_children(db, {fcode}))
    shop_id = getattr(u, "shop_id", None)
    shop_name = None
    if shop_id:
        shop = db.query(Shop).filter(Shop.id == shop_id).first()
        shop_name = shop.name if shop else None
    return UserDetail(
        id=u.id,
        username=u.username,
        email=u.email,
        full_name=u.full_name,
        role=u.role,
        external_id=u.external_id,
        family_code=u.family_code,
        photo_url=u.photo_url,
        status=u.status or ("active" if u.is_active else "inactive"),
        is_active=bool(u.is_active),
        last_synced_at=u.last_synced_at,
        allergies=u.allergies,
        customer_type=u.customer_type,
        staff_type=getattr(u, "staff_type", None),
        ps_department=getattr(u, "ps_department", None),
        card_uid=u.card_uid,
        has_children=has_kids,
        family_profile=_family_profile(db, fcode),
        family_members=_resolve_family(db, fcode),
        identity_history=_identity_history(db, "user", u.id),
        shop_id=shop_id,
        shop_name=shop_name,
    )


# ── List + Search ───────────────────────────────────────────────────────────

@router.get("/", response_model=List[UserListItem])
def list_users(
    role: Optional[str] = Query(None, description="Filter by role"),
    q: Optional[str] = Query(None, description="Search by name/email/username/external_id"),
    status_filter: Optional[str] = Query(None, alias="status", description="active | inactive"),
    db: Session = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    query = db.query(User)
    if role:
        query = query.filter(User.role == role)
    if status_filter:
        query = query.filter(User.status == status_filter)
    if q:
        pat = f"%{q.strip().lower()}%"
        query = query.filter(or_(
            User.full_name.ilike(pat),
            User.username.ilike(pat),
            User.email.ilike(pat),
            User.external_id.ilike(pat),
            User.card_uid.ilike(pat),
        ))
    users = query.order_by(User.id).all()
    # Batch-resolve has_children for all distinct family_codes
    fcodes = {u.family_code for u in users if u.family_code}
    with_kids = _families_with_children(db, fcodes)
    shop_names = _shop_name_map(db)
    return [
        _user_to_list_item(
            u,
            has_children=bool(u.family_code and u.family_code in with_kids),
            shop_names=shop_names,
        )
        for u in users
    ]


@router.get("/staff-picker")
def list_staff_for_picker(
    q: Optional[str] = Query(None, description="Search by name/username/external_id"),
    roles: Optional[str] = Query(
        None,
        description="Comma-separated roles to include (default: staff/manager/cashier/kitchen/admin)",
    ),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Lightweight user list for the requisition requester picker.

    Auth: any logged-in user. Returns minimal fields only (id, name, role,
    department label) — no PII beyond what's needed to identify the staff
    member who is taking goods.
    """
    role_list = (
        [r.strip() for r in roles.split(",") if r.strip()]
        if roles
        else ["staff", "manager", "cashier", "kitchen", "admin"]
    )
    query = db.query(User).filter(User.role.in_(role_list), User.is_active == True)
    if q:
        pat = f"%{q.strip().lower()}%"
        query = query.filter(or_(
            User.full_name.ilike(pat),
            User.username.ilike(pat),
            User.external_id.ilike(pat),
        ))
    users = query.order_by(User.full_name).limit(200).all()
    return [
        {
            "id": u.id,
            "username": u.username,
            "full_name": u.full_name,
            "role": u.role,
            "external_id": u.external_id,
            "photo_url": u.photo_url,
        }
        for u in users
    ]


@router.get("/students")
def list_students(
    q: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    """Helper for the Link Student picker — returns customers that have student_code set."""
    query = db.query(Customer).filter(Customer.student_code.isnot(None))
    if q:
        pat = f"%{q.strip().lower()}%"
        query = query.filter(or_(
            Customer.name.ilike(pat),
            Customer.student_code.ilike(pat),
            Customer.customer_code.ilike(pat),
            Customer.external_id.ilike(pat),
        ))
    rows = query.order_by(Customer.id).limit(200).all()
    return [
        {
            "id": c.id,
            "name": c.name,
            "student_code": c.student_code,
            "customer_code": c.customer_code,
            "grade": c.grade,
            "family_code": c.family_code,
            "external_id": c.external_id,
            "school_type": c.school_type,
            "card_uid": c.card_uid,
        }
        for c in rows
    ]


# ── Create student user ─────────────────────────────────────────────────────

@router.post("/students", response_model=UserDetail, status_code=status.HTTP_201_CREATED)
def create_student_user(
    body: dict,
    db: Session = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    """Create a login User account for an existing student Customer.

    Body: { customer_code, username?, password? }. Defaults: username =
    student_code, password = "parent" (mock SSO; admins rotate from UI).
    """
    from app.core.security import get_password_hash

    customer_code = (body.get("customer_code") or "").strip()
    if not customer_code:
        raise HTTPException(status_code=400, detail="customer_code is required")
    customer = db.query(Customer).filter(Customer.customer_code == customer_code).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Student not found")
    if (customer.customer_kind or "").lower() != "student":
        raise HTTPException(status_code=400, detail="Customer is not a student")
    if not customer.student_code:
        raise HTTPException(status_code=400, detail="Student has no student_code")

    username = (body.get("username") or customer.student_code).strip()
    password = (body.get("password") or "parent").strip() or "parent"

    if db.query(User).filter(User.username == username).first():
        raise HTTPException(status_code=409, detail=f"Username '{username}' already exists")

    user = User(
        username=username,
        email=f"{customer.student_code}@students.isb.ac.th",
        full_name=customer.name,
        hashed_password=get_password_hash(password),
        is_active=True,
        is_superuser=False,
        role="student",
        status="active",
        customer_type="Student",
        external_id=customer.external_id,
        family_code=customer.family_code,
        photo_url=customer.photo_url,
        last_synced_at=datetime.utcnow(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _build_detail(db, user)


# ── Detail ──────────────────────────────────────────────────────────────────

@router.get("/{user_id}", response_model=UserDetail)
def get_user_detail(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return _build_detail(db, u)


# ── Update ──────────────────────────────────────────────────────────────────

@router.patch("/{user_id}", response_model=UserDetail)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    data = payload.model_dump(exclude_unset=True)

    # Handle external_id change — log to identity_mappings
    new_ext = data.get("external_id", ...)  # sentinel
    if new_ext is not ... and (new_ext or None) != (u.external_id or None):
        reason = data.pop("external_id_change_reason", None) or "Admin manual update"
        mapping = IdentityMapping(
            entity_type="user",
            entity_id=u.id,
            old_external_id=u.external_id,
            new_external_id=new_ext or None,
            reason=reason,
            changed_by=current_user.id,
        )
        db.add(mapping)
        u.external_id = new_ext or None
        data.pop("external_id", None)
    else:
        data.pop("external_id", None)
        data.pop("external_id_change_reason", None)

    # Shop reassignment — validate existence (null = unassign)
    if "shop_id" in data:
        new_shop_id = data["shop_id"] or None
        if new_shop_id:
            shop = db.query(Shop).filter(Shop.id == new_shop_id).first()
            if not shop:
                raise HTTPException(
                    status_code=400,
                    detail=f"Shop '{new_shop_id}' not found",
                )
        u.shop_id = new_shop_id
        data.pop("shop_id", None)

    # card_uid uniqueness — check across both User and Customer tables
    if "card_uid" in data and data["card_uid"]:
        new_uid = data["card_uid"]
        dup_user = db.query(User).filter(User.card_uid == new_uid, User.id != u.id).first()
        if dup_user:
            raise HTTPException(status_code=409, detail=f"Card already assigned to user {dup_user.full_name or dup_user.username}")
        dup_cust = db.query(Customer).filter(Customer.card_uid == new_uid).first()
        if dup_cust:
            raise HTTPException(status_code=409, detail=f"Card already assigned to student {dup_cust.name} ({dup_cust.customer_code})")

    # Apply remaining simple fields
    for field in (
        "full_name", "email", "role", "family_code", "photo_url", "allergies",
        "card_uid", "customer_type",
    ):
        if field in data:
            setattr(u, field, data[field])

    if "status" in data:
        u.status = data["status"]
        u.is_active = (data["status"] == "active")

    db.commit()
    db.refresh(u)
    return _build_detail(db, u)


# ── Family (by family_code) ─────────────────────────────────────────────────

@router.get("/{user_id}/family", response_model=List[FamilyMember])
def get_user_family(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return _resolve_family(db, u.family_code)


# ── Family profile (notification_emails / login_ids) ────────────────────────

@router.patch("/family-profile/{family_code}", response_model=FamilyProfileItem)
def update_family_profile(
    family_code: str,
    payload: FamilyProfileUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    fp = db.query(FamilyProfile).filter(FamilyProfile.family_code == family_code).first()
    if not fp:
        fp = FamilyProfile(
            family_code=family_code,
            notification_emails=[],
            login_ids=[],
        )
        db.add(fp)

    data = payload.model_dump(exclude_unset=True)
    if "notification_emails" in data:
        fp.notification_emails = list(data["notification_emails"] or [])
    if "login_ids" in data:
        fp.login_ids = list(data["login_ids"] or [])
    fp.last_synced_at = fp.last_synced_at or datetime.utcnow()

    db.commit()
    db.refresh(fp)
    return FamilyProfileItem(
        family_code=fp.family_code,
        notification_emails=list(fp.notification_emails or []),
        login_ids=list(fp.login_ids or []),
        last_synced_at=fp.last_synced_at,
    )


# ── Manual link/unlink student ──────────────────────────────────────────────

@router.post("/{user_id}/link-student", response_model=LinkStudentResponse, status_code=status.HTTP_201_CREATED)
def link_student(
    user_id: int,
    payload: LinkStudentRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    parent = db.query(User).filter(User.id == user_id).first()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent user not found")
    if parent.role not in ("parent", "staff") and not parent.is_superuser:
        raise HTTPException(status_code=400, detail="User is not a parent or staff")
    child = db.query(Customer).filter(Customer.id == payload.child_customer_id).first()
    if not child:
        raise HTTPException(status_code=404, detail="Child student not found")

    existing = (
        db.query(ParentChildLink)
        .filter(
            ParentChildLink.parent_user_id == user_id,
            ParentChildLink.child_customer_id == payload.child_customer_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Link already exists")

    link = ParentChildLink(
        parent_user_id=user_id,
        child_customer_id=payload.child_customer_id,
        relation=payload.relation or "guardian",
        parent_rank=payload.parent_rank,
    )
    db.add(link)
    WalletService.ensure_wallet_for_customer(db, child.id)

    # Propagate family_code if the parent has one and the child doesn't (or vice versa)
    if parent.family_code and not child.family_code:
        child.family_code = parent.family_code
    elif child.family_code and not parent.family_code:
        parent.family_code = child.family_code

    db.commit()
    db.refresh(link)
    return LinkStudentResponse(
        link_id=link.id,
        parent_user_id=link.parent_user_id,
        child_customer_id=link.child_customer_id,
        relation=link.relation,
        parent_rank=link.parent_rank,
    )


@router.delete("/{user_id}/link-student/{customer_id}")
def unlink_student(
    user_id: int,
    customer_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    link = (
        db.query(ParentChildLink)
        .filter(
            ParentChildLink.parent_user_id == user_id,
            ParentChildLink.child_customer_id == customer_id,
        )
        .first()
    )
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    db.delete(link)
    db.commit()
    return {"success": True}
