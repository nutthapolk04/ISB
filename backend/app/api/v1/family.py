"""
Family / Parent-Child linking API.
"""
import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from pydantic import BaseModel

from app.core.database import get_db
from app.api.deps import get_current_user, require_role
from app.models.user import User
from app.models.customer import Customer
from app.models.parent_child_link import ParentChildLink
from app.services.wallet_service import WalletService

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class ChildSummary(BaseModel):
    link_id: int
    relation: str
    customer_id: int
    customer_code: str
    student_code: Optional[str] = None
    name: str
    grade: Optional[str] = None
    photo_url: Optional[str] = None
    allergies: Optional[str] = None
    card_frozen: bool = False
    wallet_id: Optional[int] = None
    wallet_balance: Optional[float] = None


class CreateLinkRequest(BaseModel):
    parent_user_id: int
    child_customer_id: int
    relation: str = "guardian"


class FamilyFreezeRequest(BaseModel):
    parent_user_id: int
    frozen: bool


class FamilyFreezeResponse(BaseModel):
    parent_user_id: int
    frozen: bool
    affected_count: int
    children: List[int]


class LinkResponse(BaseModel):
    id: int
    parent_user_id: int
    parent_username: Optional[str] = None
    parent_full_name: Optional[str] = None
    child_customer_id: int
    child_name: Optional[str] = None
    child_student_code: Optional[str] = None
    child_is_active: Optional[bool] = None
    relation: str


def _child_summary(link: ParentChildLink, customer: Customer) -> ChildSummary:
    wallet = customer.wallet
    return ChildSummary(
        link_id=link.id,
        relation=link.relation,
        customer_id=customer.id,
        customer_code=customer.customer_code,
        student_code=customer.student_code,
        name=customer.name,
        grade=customer.grade,
        photo_url=customer.photo_url,
        allergies=customer.allergies,
        card_frozen=bool(customer.card_frozen),
        wallet_id=wallet.id if wallet else None,
        wallet_balance=float(wallet.balance) if wallet else None,
    )


# ── Parent-facing: my children ───────────────────────────────────────────────

@router.get("/me", response_model=List[ChildSummary])
def my_children(
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role("parent", "staff", "cashier", "manager", "kitchen", "admin")
    ),
):
    """Return all children linked to the current user.

    Any user with rows in `parent_child_links` qualifies — PowerSchool seeds
    staff-with-children as role=staff, so we accept the broader role set here
    and rely on the link check (empty result for users without children).
    """
    links = (
        db.query(ParentChildLink)
        .filter(ParentChildLink.parent_user_id == current_user.id)
        .all()
    )
    result = []
    for link in links:
        try:
            c = (
                db.query(Customer)
                .options(joinedload(Customer.wallet))
                .filter(Customer.id == link.child_customer_id)
                .first()
            )
        except Exception as _orm_err:
            if "is_graduated" not in str(_orm_err):
                raise
            from sqlalchemy import text as _text
            from types import SimpleNamespace as _NS
            _row = db.execute(
                _text("""
                    SELECT id, customer_code, student_code, name, grade, school_type,
                           customer_kind, photo_url, email, phone, allergies, dietary_notes,
                           allergy_override_note, card_uid, card_frozen, daily_limit,
                           negative_credit_limit, external_id, family_code,
                           is_active, powerschool_sync_at
                    FROM customers WHERE id = :cid
                """),
                {"cid": link.child_customer_id},
            ).fetchone()
            if not _row:
                continue
            c = _NS(
                id=_row.id, customer_code=_row.customer_code,
                student_code=_row.student_code, name=_row.name,
                grade=_row.grade, school_type=_row.school_type,
                customer_kind=_row.customer_kind, photo_url=_row.photo_url,
                email=_row.email, phone=_row.phone,
                allergies=_row.allergies, dietary_notes=_row.dietary_notes,
                allergy_override_note=_row.allergy_override_note,
                card_uid=_row.card_uid, card_frozen=_row.card_frozen,
                daily_limit=_row.daily_limit,
                negative_credit_limit=_row.negative_credit_limit,
                external_id=_row.external_id, family_code=_row.family_code,
                is_active=_row.is_active,
                powerschool_sync_at=_row.powerschool_sync_at,
                is_graduated=False, wallet=None,
            )
        if not c or not c.is_active:
            continue
        if not c.wallet:
            WalletService.ensure_wallet_for_customer(db, c.id)
            db.commit()
            db.refresh(c)
        result.append(_child_summary(link, c))
    return result


# ── Parent-facing: low-balance alert settings ────────────────────────────────

class LowBalanceAlertSettings(BaseModel):
    child_customer_id: int
    enabled: bool
    threshold: Optional[float] = None
    last_alert_at: Optional[str] = None


class UpdateLowBalanceAlertRequest(BaseModel):
    enabled: bool
    threshold: Optional[float] = None


@router.get("/me/children/{child_id}/low-balance-alert", response_model=LowBalanceAlertSettings)
def get_low_balance_alert(
    child_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role("parent", "staff", "cashier", "manager", "kitchen", "admin")
    ),
):
    """Return the parent's low-balance alert settings for a specific child."""
    link = (
        db.query(ParentChildLink)
        .filter(
            ParentChildLink.parent_user_id == current_user.id,
            ParentChildLink.child_customer_id == child_id,
        )
        .first()
    )
    if not link:
        raise HTTPException(status_code=404, detail="Child not linked to current user")

    return LowBalanceAlertSettings(
        child_customer_id=child_id,
        enabled=bool(link.low_balance_alert_enabled),
        threshold=float(link.low_balance_threshold) if link.low_balance_threshold is not None else None,
        last_alert_at=link.last_low_balance_alert_at.isoformat() if link.last_low_balance_alert_at else None,
    )


class CoParentSummary(BaseModel):
    user_id: int
    full_name: str
    relation: Optional[str] = None
    parent_rank: Optional[str] = None
    wallet_id: Optional[int] = None
    wallet_balance: Optional[float] = None
    photo_url: Optional[str] = None
    username: Optional[str] = None


@router.get("/me/coparents", response_model=List[CoParentSummary])
def my_coparents(
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role("parent", "staff", "cashier", "manager", "kitchen", "admin")
    ),
):
    """Return other users in the same family_code group (co-parents/guardians)."""
    if not current_user.family_code:
        return []
    from app.models.wallet import Wallet
    co_users = (
        db.query(User)
        .filter(
            User.family_code == current_user.family_code,
            User.id != current_user.id,
            User.is_active == True,
        )
        .all()
    )
    result = []
    for u in co_users:
        link = (
            db.query(ParentChildLink)
            .filter(ParentChildLink.parent_user_id == u.id)
            .first()
        )
        wallet = db.query(Wallet).filter(Wallet.user_id == u.id).first()
        result.append(
            CoParentSummary(
                user_id=u.id,
                full_name=u.full_name or u.username or "",
                relation=link.relation if link else None,
                parent_rank=link.parent_rank if link else None,
                wallet_id=wallet.id if wallet else None,
                wallet_balance=float(wallet.balance) if wallet else None,
                photo_url=u.photo_url if hasattr(u, "photo_url") else None,
                username=u.username,
            )
        )
    return result


@router.put("/me/children/{child_id}/low-balance-alert", response_model=LowBalanceAlertSettings)
def update_low_balance_alert(
    child_id: int,
    payload: UpdateLowBalanceAlertRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role("parent", "staff", "cashier", "manager", "kitchen", "admin")
    ),
):
    """Toggle and configure the low-balance alert for one child.

    Enforces a positive threshold when enabling. Setting enabled=false leaves
    the threshold value intact so flipping it back on doesn't require re-entry.
    """
    link = (
        db.query(ParentChildLink)
        .filter(
            ParentChildLink.parent_user_id == current_user.id,
            ParentChildLink.child_customer_id == child_id,
        )
        .first()
    )
    if not link:
        raise HTTPException(status_code=404, detail="Child not linked to current user")

    if payload.enabled:
        if payload.threshold is None or payload.threshold <= 0:
            raise HTTPException(
                status_code=400,
                detail="Threshold must be a positive number when alerts are enabled",
            )

    link.low_balance_alert_enabled = payload.enabled
    if payload.threshold is not None:
        link.low_balance_threshold = payload.threshold
    db.commit()
    db.refresh(link)

    return LowBalanceAlertSettings(
        child_customer_id=child_id,
        enabled=bool(link.low_balance_alert_enabled),
        threshold=float(link.low_balance_threshold) if link.low_balance_threshold is not None else None,
        last_alert_at=link.last_low_balance_alert_at.isoformat() if link.last_low_balance_alert_at else None,
    )


# ── Admin: family context of a student ──────────────────────────────────────

class ParentSummary(BaseModel):
    user_id: int
    username: str
    full_name: Optional[str] = None
    role: str
    photo_url: Optional[str] = None
    wallet_id: Optional[int] = None
    wallet_balance: Optional[float] = None
    relation: str


class StudentFamilyContext(BaseModel):
    student_customer_id: int
    parents: List[ParentSummary]
    siblings: List[ChildSummary]


@router.get("/context/{student_code}", response_model=StudentFamilyContext)
def student_family_context(
    student_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Return parents and siblings of a student identified by student_code or customer_code."""
    customer = (
        db.query(Customer)
        .options(joinedload(Customer.wallet))
        .filter(
            (Customer.student_code == student_code) | (Customer.customer_code == student_code)
        )
        .first()
    )
    if not customer:
        raise HTTPException(status_code=404, detail="Student not found")

    parent_links = (
        db.query(ParentChildLink)
        .filter(ParentChildLink.child_customer_id == customer.id)
        .all()
    )

    parents: List[ParentSummary] = []
    siblings: List[ChildSummary] = []
    seen_sibling_ids: set = set()

    for pl in parent_links:
        parent = db.query(User).filter(User.id == pl.parent_user_id).first()
        if not parent:
            continue

        from app.services.wallet_service import WalletService as _WS
        pw = _WS.ensure_wallet_for_user(db, parent.id)
        db.commit()
        db.refresh(pw)

        parents.append(ParentSummary(
            user_id=parent.id,
            username=parent.username,
            full_name=parent.full_name,
            role=parent.role or "parent",
            photo_url=parent.photo_url,
            wallet_id=pw.id,
            wallet_balance=float(pw.balance),
            relation=pl.relation,
        ))

        # Siblings: other children of the same parent
        sibling_links = (
            db.query(ParentChildLink)
            .filter(
                ParentChildLink.parent_user_id == parent.id,
                ParentChildLink.child_customer_id != customer.id,
            )
            .all()
        )
        for sl in sibling_links:
            if sl.child_customer_id in seen_sibling_ids:
                continue
            seen_sibling_ids.add(sl.child_customer_id)
            sib = (
                db.query(Customer)
                .options(joinedload(Customer.wallet))
                .filter(Customer.id == sl.child_customer_id)
                .first()
            )
            if sib and sib.is_active:
                if not sib.wallet:
                    _WS.ensure_wallet_for_customer(db, sib.id)
                    db.commit()
                    db.refresh(sib)
                siblings.append(_child_summary(sl, sib))

    return StudentFamilyContext(
        student_customer_id=customer.id,
        parents=parents,
        siblings=siblings,
    )


# ── Admin: children of any user ──────────────────────────────────────────────

@router.get("/by-user/{user_id}", response_model=List[ChildSummary])
def children_of_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "kiosk")),
):
    """Return all children linked to any parent user (admin or kiosk service account)."""
    links = (
        db.query(ParentChildLink)
        .filter(ParentChildLink.parent_user_id == user_id)
        .all()
    )
    result = []
    for link in links:
        c = (
            db.query(Customer)
            .options(joinedload(Customer.wallet))
            .filter(Customer.id == link.child_customer_id)
            .first()
        )
        if not c or not c.is_active:
            continue
        if not c.wallet:
            WalletService.ensure_wallet_for_customer(db, c.id)
            db.commit()
            db.refresh(c)
        result.append(_child_summary(link, c))
    return result


# ── Admin: manage links ──────────────────────────────────────────────────────

@router.get("/links", response_model=List[LinkResponse])
def list_links(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    try:
        links = db.query(ParentChildLink).order_by(ParentChildLink.id).all()
        out = []
        for l in links:
            parent = db.query(User).filter(User.id == l.parent_user_id).first()
            child = db.query(Customer).filter(Customer.id == l.child_customer_id).first()
            out.append(LinkResponse(
                id=l.id,
                parent_user_id=l.parent_user_id,
                parent_username=parent.username if parent else None,
                parent_full_name=parent.full_name if parent else None,
                child_customer_id=l.child_customer_id,
                child_name=child.name if child else None,
                child_student_code=child.student_code if child else None,
                child_is_active=child.is_active if child else None,
                relation=l.relation,
            ))
        return out
    except Exception:
        logger.exception("list_links failed")
        raise


@router.post("/links", response_model=LinkResponse, status_code=status.HTTP_201_CREATED)
def create_link(
    payload: CreateLinkRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    # Validate existence
    parent = db.query(User).filter(User.id == payload.parent_user_id).first()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent user not found")
    if parent.role != "parent" and not parent.is_superuser:
        raise HTTPException(status_code=400, detail="User is not a parent")
    child = db.query(Customer).filter(Customer.id == payload.child_customer_id).first()
    if not child:
        raise HTTPException(status_code=404, detail="Child customer not found")
    # Duplicate check
    existing = (
        db.query(ParentChildLink)
        .filter(
            ParentChildLink.parent_user_id == payload.parent_user_id,
            ParentChildLink.child_customer_id == payload.child_customer_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Link already exists")

    link = ParentChildLink(
        parent_user_id=payload.parent_user_id,
        child_customer_id=payload.child_customer_id,
        relation=payload.relation or "guardian",
    )
    db.add(link)
    # Ensure child has a wallet
    WalletService.ensure_wallet_for_customer(db, child.id)
    db.commit()
    db.refresh(link)
    return LinkResponse(
        id=link.id,
        parent_user_id=link.parent_user_id,
        parent_username=parent.username,
        parent_full_name=parent.full_name,
        child_customer_id=link.child_customer_id,
        child_name=child.name,
        child_student_code=child.student_code,
        relation=link.relation,
    )


@router.delete("/links/{link_id}")
def delete_link(
    link_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    link = db.query(ParentChildLink).filter(ParentChildLink.id == link_id).first()
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    db.delete(link)
    db.commit()
    return {"success": True}


# ── Global (family-level) freeze ────────────────────────────────────────────

@router.post("/freeze-all", response_model=FamilyFreezeResponse)
def freeze_all_children(
    payload: FamilyFreezeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role("admin", "parent", "staff", "cashier", "manager", "kitchen")
    ),
):
    """Freeze or unfreeze ALL children of a parent in one call (emergency control)."""
    parent = db.query(User).filter(User.id == payload.parent_user_id).first()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent user not found")

    # Parents can only freeze their own family; admin can freeze anyone's
    is_admin = current_user.is_superuser or current_user.role == "admin"
    if not is_admin and current_user.id != payload.parent_user_id:
        raise HTTPException(status_code=403, detail="Parents can only freeze their own family")

    links = (
        db.query(ParentChildLink)
        .filter(ParentChildLink.parent_user_id == payload.parent_user_id)
        .all()
    )
    affected: List[int] = []
    for link in links:
        c = db.query(Customer).filter(Customer.id == link.child_customer_id).first()
        if c and bool(c.card_frozen) != bool(payload.frozen):
            c.card_frozen = bool(payload.frozen)
            affected.append(c.id)
    db.commit()
    return FamilyFreezeResponse(
        parent_user_id=payload.parent_user_id,
        frozen=payload.frozen,
        affected_count=len(affected),
        children=affected,
    )


# ── Reconciliation ──────────────────────────────────────────────────────────

class OrphanParent(BaseModel):
    user_id: int
    username: str
    full_name: str
    email: Optional[str] = None
    family_code: Optional[str] = None
    external_id: Optional[str] = None
    customer_type: Optional[str] = None


class OrphanStudent(BaseModel):
    customer_id: int
    customer_code: str
    student_code: Optional[str] = None
    name: str
    grade: Optional[str] = None
    family_code: Optional[str] = None
    external_id: Optional[str] = None


class OrphansResponse(BaseModel):
    """Both sides of the reconciliation view.

    - `parents_no_children`: role=parent + active, but ZERO parent_child_links
    - `students_no_parents`: student-like customers (student_code set) with
      no parent link
    Each list is independent; a record may also be missing a `family_code`.
    """
    parents_no_children: List[OrphanParent]
    students_no_parents: List[OrphanStudent]


@router.get("/orphans", response_model=OrphansResponse)
def list_orphans(
    db: Session = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    linked_parent_ids = {
        row[0] for row in db.query(ParentChildLink.parent_user_id).distinct().all()
    }
    linked_child_ids = {
        row[0] for row in db.query(ParentChildLink.child_customer_id).distinct().all()
    }

    parent_users = (
        db.query(User)
        .filter(User.role == "parent", User.is_active.is_(True))
        .all()
    )
    orphan_parents = [
        OrphanParent(
            user_id=u.id,
            username=u.username,
            full_name=u.full_name or u.username,
            email=u.email,
            family_code=u.family_code,
            external_id=u.external_id,
            customer_type=u.customer_type,
        )
        for u in parent_users if u.id not in linked_parent_ids
    ]

    student_customers = (
        db.query(Customer)
        .filter(Customer.student_code.isnot(None), Customer.is_active.is_(True))
        .all()
    )
    orphan_students = [
        OrphanStudent(
            customer_id=c.id,
            customer_code=c.customer_code,
            student_code=c.student_code,
            name=c.name,
            grade=c.grade,
            family_code=c.family_code,
            external_id=c.external_id,
        )
        for c in student_customers if c.id not in linked_child_ids
    ]

    return OrphansResponse(
        parents_no_children=orphan_parents,
        students_no_parents=orphan_students,
    )
