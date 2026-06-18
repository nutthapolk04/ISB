"""
Customer / Student API — lookup (by code/uid) + card management.
"""
import logging
from typing import Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import text

from app.core.database import get_db
from app.api.deps import get_current_user, require_role
from app.models.user import User
from app.models.customer import Customer, CustomerType, CustomerTypeEnum
from app.models.parent_child_link import ParentChildLink
from app.models.wallet import Wallet
from app.schemas.customer import (
    StudentProfileResponse,
    FreezeCardRequest,
    DailyLimitRequest,
    NegativeCreditLimitRequest,
    AllergyUpdateRequest,
    CardBindRequest,
    CreateStudentRequest,
    GraduateRequest,
    GraduateResponse,
    CustomerBasicUpdate,
)
from app.services.wallet_service import WalletService

logger = logging.getLogger(__name__)
router = APIRouter()


def _spent_today_by_module(db: Session, customer_id: int) -> Dict[str, float]:
    """Return today's total spend per shop module for a customer (Thailand timezone)."""
    rows = db.execute(text("""
        SELECT s.module, COALESCE(SUM(r.total), 0)
        FROM receipts r
        JOIN shops s ON s.id = r.shop_id
        WHERE r.customer_id = :cid
          AND r.status = 'active'
          AND (r.transaction_date AT TIME ZONE 'Asia/Bangkok')::date
              = (now() AT TIME ZONE 'Asia/Bangkok')::date
        GROUP BY s.module
    """), {"cid": customer_id}).fetchall()
    result: Dict[str, float] = {"canteen": 0.0, "store": 0.0}
    for module, total in rows:
        if module in result:
            result[module] = float(total)
    return result


def _user_to_search_profile(u: User) -> StudentProfileResponse:
    """Map a User row (parent/staff/teacher) to the search-result shape."""
    wallet = u.wallet
    return StudentProfileResponse(
        id=u.id,
        user_id=u.id,            # signals "user-based payer" to the frontend
        customer_code=u.username,
        student_code=None,
        name=u.full_name or u.username,
        grade=None,
        school_type=None,
        customer_kind=u.role or "user",
        photo_url=u.photo_url,
        email=u.email,
        card_uid=u.card_uid,
        card_frozen=False,
        family_code=u.family_code,
        external_id=u.external_id,
        wallet_id=wallet.id if wallet else None,
        wallet_balance=float(wallet.balance) if wallet else None,
        allergies=getattr(u, "allergies", None),
    )


def _to_profile(c: Customer, db: Optional[Session] = None) -> StudentProfileResponse:
    wallet = c.wallet
    spent = _spent_today_by_module(db, c.id) if db is not None else {}
    return StudentProfileResponse(
        id=c.id,
        customer_code=c.customer_code,
        student_code=c.student_code,
        name=c.name,
        grade=c.grade,
        photo_url=c.photo_url,
        email=c.email,
        phone=c.phone,
        allergies=c.allergies,
        dietary_notes=c.dietary_notes,
        allergy_override_note=c.allergy_override_note,
        card_uid=c.card_uid,
        card_frozen=bool(c.card_frozen),
        daily_limit=float(c.daily_limit) if c.daily_limit is not None else None,
        daily_limit_canteen=float(c.daily_limit_canteen) if c.daily_limit_canteen is not None else None,
        daily_limit_store=float(c.daily_limit_store) if c.daily_limit_store is not None else None,
        spent_today_canteen=spent.get("canteen"),
        spent_today_store=spent.get("store"),
        negative_credit_limit=float(c.negative_credit_limit) if c.negative_credit_limit is not None else None,
        school_type=c.school_type,
        external_id=c.external_id,
        family_code=c.family_code,
        wallet_id=wallet.id if wallet else None,
        wallet_balance=float(wallet.balance) if wallet else None,
    )


def _authz_access_customer(db: Session, user: User, customer: Customer):
    """Check if user can view/edit a customer profile.

    Any user (parent OR staff/kitchen — anyone with a child link in
    `parent_child_links`) can view their linked child. Role gating is loose
    here because PowerSchool seeds staff-with-children as role=staff, and we
    don't want to fall back to manual role-fix for those accounts.
    """
    if user.is_superuser or user.role in ("admin", "manager", "cashier"):
        return
    link = (
        db.query(ParentChildLink)
        .filter(
            ParentChildLink.parent_user_id == user.id,
            ParentChildLink.child_customer_id == customer.id,
        )
        .first()
    )
    if link:
        return
    raise HTTPException(status_code=403, detail="Not authorized")


# ── Lookup endpoints (used by cashier at POS) ────────────────────────────────

@router.get("/search", response_model=List[StudentProfileResponse])
def search_customers(
    q: str,
    limit: int = 10,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role("cashier", "manager", "admin", "kitchen", "kiosk", "staff")
    ),
):
    """Search all members — students (Customer table) + parents/staff/teachers (User table).

    Matches on: name, student_code, customer_code, card_uid, family_code,
                external_id, email, phone, username.
    """
    q = q.strip()
    if len(q) < 2:
        raise HTTPException(status_code=400, detail="Query must be at least 2 characters")

    search_pattern = f"%{q}%"

    # ── 1. Students / departments (Customer table) ──────────────────────────
    customers = (
        db.query(Customer)
        .options(joinedload(Customer.wallet))
        .filter(
            Customer.is_active == True,
            (
                Customer.name.ilike(search_pattern) |
                Customer.student_code.ilike(search_pattern) |
                Customer.customer_code.ilike(search_pattern) |
                Customer.card_uid.ilike(search_pattern) |
                Customer.family_code.ilike(search_pattern) |
                Customer.external_id.ilike(search_pattern) |
                Customer.email.ilike(search_pattern) |
                Customer.phone.ilike(search_pattern)
            )
        )
        .order_by(Customer.name)
        .limit(limit)
        .all()
    )

    # Ensure wallets exist
    for c in customers:
        if not c.wallet:
            WalletService.ensure_wallet_for_customer(db, c.id)
    db.commit()

    # ── 2. Parents / staff / teachers (User table) ───────────────────────────
    users = (
        db.query(User)
        .options(joinedload(User.wallet))
        .filter(
            User.is_active == True,
            User.role.in_(["parent", "staff", "teacher", "visitor"]),
            (
                User.full_name.ilike(search_pattern) |
                User.username.ilike(search_pattern) |
                User.email.ilike(search_pattern) |
                User.family_code.ilike(search_pattern) |
                User.external_id.ilike(search_pattern) |
                User.card_uid.ilike(search_pattern)
            )
        )
        .order_by(User.full_name)
        .limit(limit)
        .all()
    )

    results: List[StudentProfileResponse] = [_to_profile(c) for c in customers]
    results += [_user_to_search_profile(u) for u in users]
    # Sort combined list by name, then trim to limit
    results.sort(key=lambda r: r.name.lower())
    return results[:limit * 2]  # allow up to 2× limit so both sources are visible


@router.get("/by-code/{code}", response_model=StudentProfileResponse)
def get_customer_by_code(
    code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Look up student by customer_code or student_code."""
    c = (
        db.query(Customer)
        .options(joinedload(Customer.wallet))
        .filter(
            Customer.student_code.ilike(code) | Customer.customer_code.ilike(code)
        )
        .first()
    )
    if not c:
        raise HTTPException(status_code=404, detail="Student not found")
    # Ensure wallet exists
    if not c.wallet:
        WalletService.ensure_wallet_for_customer(db, c.id)
        db.commit()
        db.refresh(c)
    return _to_profile(c)


@router.get("/by-card/{uid}", response_model=StudentProfileResponse)
def get_customer_by_card(
    uid: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Look up student by NFC card UID (case-insensitive)."""
    c = (
        db.query(Customer)
        .options(joinedload(Customer.wallet))
        .filter(Customer.card_uid.ilike(uid))
        .first()
    )
    if not c:
        raise HTTPException(status_code=404, detail="ไม่พบบัตรนี้ในระบบ")
    if not c.wallet:
        WalletService.ensure_wallet_for_customer(db, c.id)
        db.commit()
        db.refresh(c)
    return _to_profile(c)


@router.get("/{customer_id}", response_model=StudentProfileResponse)
def get_customer_profile(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    c = (
        db.query(Customer)
        .options(joinedload(Customer.wallet))
        .filter(Customer.id == customer_id)
        .first()
    )
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    _authz_access_customer(db, current_user, c)
    if not c.wallet:
        WalletService.ensure_wallet_for_customer(db, c.id)
        db.commit()
        db.refresh(c)
    return _to_profile(c, db)


@router.patch("/{customer_id}", response_model=StudentProfileResponse)
def update_customer_basic(
    customer_id: int,
    payload: CustomerBasicUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Admin: update basic student info (name, grade, school_type, email, phone)."""
    c = (
        db.query(Customer)
        .options(joinedload(Customer.wallet))
        .filter(Customer.id == customer_id)
        .first()
    )
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    _authz_access_customer(db, current_user, c)
    if payload.name is not None:
        c.name = payload.name
    if payload.grade is not None:
        c.grade = payload.grade
    if payload.school_type is not None:
        c.school_type = payload.school_type
    if payload.email is not None:
        c.email = payload.email
    if payload.phone is not None:
        c.phone = payload.phone
    if payload.family_code is not None:
        # Empty string clears the family link — keeps the value optional.
        c.family_code = payload.family_code.strip() or None
    db.commit()
    db.refresh(c)
    return _to_profile(c)


@router.delete("/{customer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Admin: hard-delete a customer (student / cardholder).

    Wallet + parent_child_link rows cascade via FK ondelete=CASCADE. Past
    receipts are orphaned (customer_id → NULL) so the sales audit trail
    survives — they only lose the link back to the deleted profile.
    """
    cust = db.query(Customer).filter(Customer.id == customer_id).first()
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")
    from app.models.receipt import Receipt
    db.query(Receipt).filter(Receipt.customer_id == customer_id).update(
        {"customer_id": None}, synchronize_session=False
    )
    db.delete(cust)
    db.commit()
    return None


# ── Card management (parent or admin) ────────────────────────────────────────

@router.post("/{customer_id}/freeze", response_model=StudentProfileResponse)
def freeze_card(
    customer_id: int,
    payload: FreezeCardRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role("parent", "staff", "cashier", "manager", "kitchen", "admin")
    ),
):
    c = db.query(Customer).options(joinedload(Customer.wallet)).filter(Customer.id == customer_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    _authz_access_customer(db, current_user, c)
    c.card_frozen = bool(payload.frozen)
    db.commit()
    db.refresh(c)
    return _to_profile(c)


@router.patch("/{customer_id}/limit", response_model=StudentProfileResponse)
def set_daily_limit(
    customer_id: int,
    payload: DailyLimitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role("parent", "staff", "cashier", "manager", "kitchen", "admin")
    ),
):
    c = db.query(Customer).options(joinedload(Customer.wallet)).filter(Customer.id == customer_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    _authz_access_customer(db, current_user, c)
    fields = payload.model_fields_set
    if "daily_limit" in fields:
        c.daily_limit = payload.daily_limit
    if "daily_limit_canteen" in fields:
        c.daily_limit_canteen = payload.daily_limit_canteen
    if "daily_limit_store" in fields:
        c.daily_limit_store = payload.daily_limit_store
    db.commit()
    db.refresh(c)
    return _to_profile(c, db)


@router.patch("/{customer_id}/allergies", response_model=StudentProfileResponse)
def update_allergies(
    customer_id: int,
    payload: AllergyUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    c = db.query(Customer).options(joinedload(Customer.wallet)).filter(Customer.id == customer_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    if payload.allergies is not None:
        c.allergies = payload.allergies
    if payload.dietary_notes is not None:
        c.dietary_notes = payload.dietary_notes
    if payload.allergy_override_note is not None:
        c.allergy_override_note = payload.allergy_override_note or None
    db.commit()
    db.refresh(c)
    return _to_profile(c)


@router.patch("/{customer_id}/negative-limit", response_model=StudentProfileResponse)
def set_negative_credit_limit(
    customer_id: int,
    payload: NegativeCreditLimitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Admin: set max overdraft allowed for this customer (null = no overdraft)."""
    c = db.query(Customer).options(joinedload(Customer.wallet)).filter(Customer.id == customer_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    c.negative_credit_limit = payload.negative_credit_limit
    db.commit()
    db.refresh(c)
    return _to_profile(c)


@router.patch("/{customer_id}/card", response_model=StudentProfileResponse)
def bind_card(
    customer_id: int,
    payload: CardBindRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Admin: bind or unbind an NFC card UID to a customer."""
    c = db.query(Customer).options(joinedload(Customer.wallet)).filter(Customer.id == customer_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    if payload.card_uid:
        existing_cust = (
            db.query(Customer)
            .filter(Customer.card_uid == payload.card_uid, Customer.id != customer_id)
            .first()
        )
        if existing_cust:
            raise HTTPException(status_code=409, detail=f"Card already assigned to student {existing_cust.name} ({existing_cust.customer_code})")
        existing_user = db.query(User).filter(User.card_uid == payload.card_uid).first()
        if existing_user:
            raise HTTPException(status_code=409, detail=f"Card already assigned to user {existing_user.full_name or existing_user.username}")
    c.card_uid = payload.card_uid or None
    db.commit()
    db.refresh(c)
    return _to_profile(c)


# ── Admin: create student ────────────────────────────────────────────────────

@router.post("/", response_model=StudentProfileResponse, status_code=status.HTTP_201_CREATED)
def create_student(
    payload: CreateStudentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Admin creates a student Customer + wallet."""
    if db.query(Customer).filter(Customer.customer_code == payload.customer_code).first():
        raise HTTPException(status_code=409, detail="customer_code already exists")
    if payload.student_code and db.query(Customer).filter(Customer.student_code == payload.student_code).first():
        raise HTTPException(status_code=409, detail="student_code already exists")
    if payload.card_uid and db.query(Customer).filter(Customer.card_uid == payload.card_uid).first():
        raise HTTPException(status_code=409, detail="card_uid already exists")

    # Determine customer_type_id (default to first internal type if exists)
    type_id = payload.customer_type_id
    if not type_id:
        ct = db.query(CustomerType).filter(CustomerType.type_name == CustomerTypeEnum.INTERNAL).first()
        if not ct:
            # create default if missing
            ct = CustomerType(type_name=CustomerTypeEnum.INTERNAL, description="Student/staff", default_price_level="internal")
            db.add(ct)
            db.flush()
        type_id = ct.id

    c = Customer(
        customer_code=payload.customer_code,
        name=payload.name,
        student_code=payload.student_code,
        grade=payload.grade,
        email=payload.email,
        phone=payload.phone,
        allergies=payload.allergies,
        dietary_notes=payload.dietary_notes,
        card_uid=payload.card_uid,
        photo_url=payload.photo_url,
        customer_type_id=type_id,
        is_active=True,
    )
    db.add(c)
    db.flush()

    # Create wallet with initial balance
    from app.models.wallet import Wallet
    w = Wallet(customer_id=c.id, balance=payload.initial_balance or 0, is_active=True)
    db.add(w)
    db.commit()
    db.refresh(c)
    return _to_profile(c)


# ── Photo upload (Cloudinary) ────────────────────────────────────────────────

@router.post("/{customer_id}/photo", response_model=StudentProfileResponse)
async def upload_customer_photo(
    customer_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Admin upload a profile photo for a student. Stored on Cloudinary."""
    from app.core.config import settings
    from app.services.upload_service import upload_student_photo

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    # Read content to enforce size limit (UploadFile.size is not always available)
    content = await file.read()
    if len(content) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail=f"File too large (max {settings.MAX_UPLOAD_SIZE // 1_000_000} MB)")

    c = db.query(Customer).options(joinedload(Customer.wallet)).filter(Customer.id == customer_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")

    try:
        import io
        url = upload_student_photo(io.BytesIO(content), c.customer_code)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception:
        logger.exception("Cloudinary upload failed for customer %s", customer_id)
        raise HTTPException(status_code=502, detail="Photo upload failed")

    c.photo_url = url
    db.commit()
    db.refresh(c)
    return _to_profile(c)


# ── Graduation (auto-transfer balance to sibling) ────────────────────────────

@router.post("/{customer_id}/graduate", response_model=GraduateResponse)
def graduate_student(
    customer_id: int,
    payload: GraduateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Mark student graduated and auto-transfer remaining balance to a sibling.

    Flow:
    - If no wallet balance → just deactivate.
    - If balance > 0 and target specified → transfer there.
    - If balance > 0 and no target + exactly 1 sibling → auto-transfer.
    - If balance > 0 and multiple siblings → return list for admin to pick.
    - If balance > 0 and no siblings → deactivate but leave balance for admin action.
    """
    from datetime import datetime
    c = db.query(Customer).options(joinedload(Customer.wallet)).filter(Customer.id == customer_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")

    wallet = c.wallet
    balance = float(wallet.balance) if wallet else 0.0

    # Find parents of this student
    parent_ids = [
        l.parent_user_id for l in
        db.query(ParentChildLink).filter(ParentChildLink.child_customer_id == customer_id).all()
    ]
    # Find siblings = other active customers linked to the same parent(s)
    siblings: list[Customer] = []
    if parent_ids:
        sibling_rows = (
            db.query(Customer)
            .join(ParentChildLink, ParentChildLink.child_customer_id == Customer.id)
            .filter(
                ParentChildLink.parent_user_id.in_(parent_ids),
                Customer.id != customer_id,
                Customer.is_active == True,
            )
            .distinct()
            .all()
        )
        siblings = sibling_rows

    transferred_to: Optional[int] = None
    transferred_amount = 0.0
    message = ""

    if balance > 0 and wallet:
        target_id = payload.transfer_to_customer_id
        if target_id is None:
            if len(siblings) == 1:
                target_id = siblings[0].id
            elif len(siblings) > 1:
                return GraduateResponse(
                    customer_id=customer_id,
                    deactivated=False,
                    transferred_to_customer_id=None,
                    transferred_amount=0.0,
                    siblings_available=[s.id for s in siblings],
                    message="Multiple siblings found — specify transfer_to_customer_id",
                )

        if target_id is not None:
            target = next((s for s in siblings if s.id == target_id), None)
            if not target:
                raise HTTPException(status_code=400, detail=f"Customer {target_id} is not a sibling of {customer_id}")
            target_wallet = WalletService.ensure_wallet_for_customer(db, target.id)
            db.flush()

            try:
                WalletService.transfer_between_siblings(
                    db,
                    from_wallet_id=wallet.id,
                    to_wallet_id=target_wallet.id,
                    amount=balance,
                    initiator_user_id=current_user.id,
                    initiator_is_admin=True,
                    note=f"Graduation transfer from {c.name}",
                )
                transferred_to = target.id
                transferred_amount = balance
                message = f"Transferred ฿{balance:.2f} to sibling {target.name}"
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
        else:
            message = f"No siblings found — balance ฿{balance:.2f} left in wallet, needs admin action"

    # Deactivate and mark graduated
    c.is_active = False
    c.is_graduated = True
    c.card_frozen = True
    c.powerschool_sync_at = datetime.utcnow()
    db.commit()

    return GraduateResponse(
        customer_id=customer_id,
        deactivated=True,
        transferred_to_customer_id=transferred_to,
        transferred_amount=transferred_amount,
        siblings_available=[s.id for s in siblings],
        message=message or "Student deactivated",
    )


@router.get("/", response_model=List[StudentProfileResponse])
def list_students(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    try:
        customers = (
            db.query(Customer)
            .options(joinedload(Customer.wallet))
            .filter(Customer.is_active == True)
            .order_by(Customer.id)
            .all()
        )
        return [_to_profile(c) for c in customers]
    except Exception:
        logger.exception("list_students failed")
        raise
