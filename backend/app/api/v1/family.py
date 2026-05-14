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
        c = (
            db.query(Customer)
            .options(joinedload(Customer.wallet))
            .filter(Customer.id == link.child_customer_id)
            .first()
        )
        if not c:
            continue
        if not c.wallet:
            WalletService.ensure_wallet_for_customer(db, c.id)
            db.commit()
            db.refresh(c)
        result.append(_child_summary(link, c))
    return result


# ── Admin: children of any user ──────────────────────────────────────────────

@router.get("/by-user/{user_id}", response_model=List[ChildSummary])
def children_of_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Return all children linked to any parent user (admin-only)."""
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
        if not c:
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
