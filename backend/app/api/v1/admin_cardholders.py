"""
Unified Cardholder Management — admin-only endpoints.

Provides a single list/create surface that spans the 5 cardholder kinds
(student, parent, staff, department, other) which live across User, Customer,
and Department tables. Plus background-job style PowerSchool sync triggers
and per-record sync audit retrieval.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.api.deps import require_role
from app.core.database import SessionLocal, get_db
from app.core.security import get_password_hash
from app.models.customer import Customer, CustomerType, CustomerTypeEnum
from app.models.department import Department
from app.models.shop import Shop
from app.models.sync_audit_log import SyncAuditLog
from app.models.sync_log import SyncLog
from app.models.user import User
from app.models.wallet import Wallet
from app.schemas.customer import (
    CardholderListResponse,
    CardholderResponse,
    CreateCardholderRequest,
    SyncAuditEntry,
    SyncRunRequest,
    SyncStatusResponse,
)
from app.services.department_service import DepartmentService
from app.services.wallet_service import WalletService

logger = logging.getLogger(__name__)
router = APIRouter()


# Roles that get a personal wallet auto-provisioned at creation time (mirrors
# WALLET_ROLES in user_service to avoid circular imports).
_WALLET_USER_ROLES = {"parent", "cashier", "manager", "kitchen", "admin", "staff"}
_STAFF_ROLES = {"cashier", "manager", "kitchen", "staff"}


# ── List ─────────────────────────────────────────────────────────────────────


def _user_to_cardholder(u: User, wallet: Optional[Wallet]) -> CardholderResponse:
    role = u.role or ""
    kind = "parent" if role == "parent" else "staff"
    return CardholderResponse(
        key=f"u-{u.id}",
        kind=kind,
        entity_type="user",
        entity_id=u.id,
        name=u.full_name,
        identifier=u.username,
        photo_url=u.photo_url,
        family_code=u.family_code,
        external_id=u.external_id,
        card_uid=u.card_uid,
        wallet_id=wallet.id if wallet else None,
        wallet_balance=float(wallet.balance) if wallet else None,
        is_active=bool(u.is_active),
        role=role or None,
        shop_id=u.shop_id,
        synced_at=u.last_synced_at,
    )


def _customer_to_cardholder(c: Customer, wallet: Optional[Wallet]) -> CardholderResponse:
    raw_kind = (c.customer_kind or "other").lower()
    if raw_kind not in ("student", "department", "other"):
        raw_kind = "other"
    return CardholderResponse(
        key=f"c-{c.id}",
        kind=raw_kind,  # type: ignore[arg-type]
        entity_type="customer",
        entity_id=c.id,
        name=c.name,
        identifier=c.student_code or c.customer_code,
        photo_url=c.photo_url,
        family_code=c.family_code,
        external_id=c.external_id,
        card_uid=c.card_uid,
        wallet_id=wallet.id if wallet else None,
        wallet_balance=float(wallet.balance) if wallet else None,
        is_active=bool(c.is_active),
        grade=c.grade,
        school_type=c.school_type,
        allergies=c.allergies,
        synced_at=c.powerschool_sync_at,
    )


def _department_to_cardholder(d: Department, wallet: Optional[Wallet]) -> CardholderResponse:
    return CardholderResponse(
        key=f"d-{d.id}",
        kind="department",
        entity_type="department",
        entity_id=d.id,
        name=d.department_name,
        identifier=d.department_code,
        wallet_id=wallet.id if wallet else None,
        wallet_balance=float(wallet.balance) if wallet else None,
        is_active=bool(d.is_active),
        department_code=d.department_code,
    )


@router.get("/cardholders", response_model=CardholderListResponse)
def list_cardholders(
    kind: Optional[str] = Query(None, description="student|parent|staff|department|other|all"),
    q: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    """Unified list across User + Customer + Department, filtered by kind/search.

    Implementation note: dataset is small (low hundreds) so we merge in Python
    after per-source queries instead of a polymorphic SQL union.
    """
    pattern = f"%{q.strip()}%" if q and q.strip() else None

    # Users (parent + staff roles)
    users: List[User] = []
    if kind in (None, "all", "parent", "staff"):
        u_query = db.query(User)
        if kind == "parent":
            u_query = u_query.filter(User.role == "parent")
        elif kind == "staff":
            u_query = u_query.filter(User.role.in_(_STAFF_ROLES | {"admin"}))
        else:
            # parent + staff + admin (admin shows under "staff")
            u_query = u_query.filter(User.role.in_(_STAFF_ROLES | {"parent", "admin"}))
        if pattern:
            u_query = u_query.filter(
                or_(
                    User.username.ilike(pattern),
                    User.full_name.ilike(pattern),
                    User.email.ilike(pattern),
                    User.external_id.ilike(pattern),
                    User.family_code.ilike(pattern),
                )
            )
        users = u_query.all()

    # Customers (student/other; not parent/staff)
    customers: List[Customer] = []
    if kind in (None, "all", "student", "other"):
        c_query = db.query(Customer).options(joinedload(Customer.wallet))
        if kind == "student":
            c_query = c_query.filter(Customer.customer_kind == "student")
        elif kind == "other":
            c_query = c_query.filter(Customer.customer_kind == "other")
        else:
            c_query = c_query.filter(Customer.customer_kind.in_(["student", "other"]))
        if pattern:
            c_query = c_query.filter(
                or_(
                    Customer.name.ilike(pattern),
                    Customer.customer_code.ilike(pattern),
                    Customer.student_code.ilike(pattern),
                    Customer.external_id.ilike(pattern),
                    Customer.family_code.ilike(pattern),
                )
            )
        customers = c_query.all()

    # Departments
    departments: List[Department] = []
    if kind in (None, "all", "department"):
        d_query = db.query(Department).options(joinedload(Department.wallet))
        if pattern:
            d_query = d_query.filter(
                or_(
                    Department.department_code.ilike(pattern),
                    Department.department_name.ilike(pattern),
                )
            )
        departments = d_query.all()

    # Resolve user wallets in a single query keyed by user_id
    user_wallets: Dict[int, Wallet] = {}
    if users:
        user_ids = [u.id for u in users]
        for w in db.query(Wallet).filter(Wallet.user_id.in_(user_ids)).all():
            user_wallets[w.user_id] = w

    # Merge + sort
    rows: List[CardholderResponse] = []
    for u in users:
        rows.append(_user_to_cardholder(u, user_wallets.get(u.id)))
    for c in customers:
        rows.append(_customer_to_cardholder(c, c.wallet))
    for d in departments:
        rows.append(_department_to_cardholder(d, d.wallet))

    rows.sort(key=lambda r: (r.kind, r.name.lower()))
    total = len(rows)
    start = (page - 1) * page_size
    page_rows = rows[start : start + page_size]
    return CardholderListResponse(items=page_rows, total=total)


# ── Create ───────────────────────────────────────────────────────────────────


@router.post("/cardholders", response_model=CardholderResponse, status_code=status.HTTP_201_CREATED)
def create_cardholder(
    payload: CreateCardholderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    """Create a cardholder. Form fields are interpreted per `kind`."""
    kind = payload.kind

    if kind == "student":
        if not payload.customer_code or not payload.name:
            raise HTTPException(400, "customer_code and name are required for student")
        ct = db.query(CustomerType).filter(
            CustomerType.type_name == CustomerTypeEnum.INTERNAL
        ).first()
        if not ct:
            ct = CustomerType(
                type_name=CustomerTypeEnum.INTERNAL,
                description="Internal",
                default_price_level="internal",
            )
            db.add(ct)
            db.flush()
        existing = db.query(Customer).filter(Customer.customer_code == payload.customer_code).first()
        if existing:
            raise HTTPException(409, f"Customer code {payload.customer_code} exists")
        c = Customer(
            customer_code=payload.customer_code,
            name=payload.name,
            student_code=payload.student_code,
            grade=payload.grade,
            school_type=payload.school_type,
            family_code=payload.family_code,
            card_uid=payload.card_uid,
            customer_type_id=ct.id,
            customer_kind="student",
            customer_type="Student",
            is_active=True,
        )
        db.add(c)
        db.flush()
        wallet = Wallet(customer_id=c.id, balance=payload.initial_balance or 0, is_active=True)
        db.add(wallet)

        # Also create a Student User account (login = student_code, default
        # password). Skip silently if student_code is missing or username
        # collides — admin can fix from the user list later.
        if payload.student_code:
            existing_user = db.query(User).filter(User.username == payload.student_code).first()
            if not existing_user:
                student_user = User(
                    username=payload.student_code,
                    email=f"{payload.student_code}@students.isb.ac.th",
                    full_name=payload.name,
                    hashed_password=get_password_hash("parent"),
                    is_active=True,
                    is_superuser=False,
                    role="student",
                    status="active",
                    customer_type="Student",
                    external_id=payload.student_code,
                    family_code=payload.family_code,
                )
                db.add(student_user)

        db.commit()
        db.refresh(c)
        return _customer_to_cardholder(c, c.wallet)

    if kind in ("parent", "staff"):
        if not payload.username or not payload.name or not payload.password:
            raise HTTPException(400, "username, name, password are required")
        pw = payload.password
        if len(pw) < 8:
            raise HTTPException(400, "Password must be at least 8 characters")
        if not any(c.isdigit() or not c.isalnum() for c in pw):
            raise HTTPException(400, "Password must contain at least one number or special character")
        if db.query(User).filter(User.username == payload.username).first():
            raise HTTPException(409, f"Username {payload.username} exists")
        role = "parent" if kind == "parent" else (payload.role or "staff")
        if role not in _WALLET_USER_ROLES:
            raise HTTPException(400, f"Invalid role {role}")
        if payload.shop_id:
            shop = db.query(Shop).filter(Shop.id == payload.shop_id).first()
            if not shop:
                raise HTTPException(400, f"Shop {payload.shop_id} not found")
        u = User(
            username=payload.username,
            email=payload.email or f"{payload.username}@isb-coop.local",
            full_name=payload.name,
            hashed_password=get_password_hash(payload.password),
            role=role,
            shop_id=payload.shop_id,
            family_code=payload.family_code,
            card_uid=payload.card_uid,
            is_active=True,
            is_superuser=False,
            status="active",
        )
        db.add(u)
        db.flush()
        WalletService.ensure_wallet_for_user(db, u.id)
        db.commit()
        db.refresh(u)
        wallet = db.query(Wallet).filter(Wallet.user_id == u.id).first()
        return _user_to_cardholder(u, wallet)

    if kind == "department":
        if not payload.department_code or not payload.department_name:
            raise HTTPException(400, "department_code and department_name required")
        try:
            dept = DepartmentService.create_department(
                db,
                code=payload.department_code,
                name=payload.department_name,
                initial_credit=payload.initial_credit or 0,
            )
        except ValueError as e:
            raise HTTPException(409, str(e))
        return _department_to_cardholder(dept, dept.wallet)

    if kind == "other":
        if not payload.name:
            raise HTTPException(400, "name required for other")
        ct = db.query(CustomerType).filter(
            CustomerType.type_name == CustomerTypeEnum.PUBLIC
        ).first()
        if not ct:
            ct = CustomerType(
                type_name=CustomerTypeEnum.PUBLIC,
                description="Public/visitor",
                default_price_level="retail",
            )
            db.add(ct)
            db.flush()
        code = payload.customer_code or f"OTH-{int(datetime.utcnow().timestamp())}"
        c = Customer(
            customer_code=code,
            name=payload.name,
            email=payload.email,
            phone=payload.phone,
            customer_type_id=ct.id,
            customer_kind="other",
            customer_type="Other",
            is_active=True,
        )
        db.add(c)
        db.flush()
        if payload.with_wallet:
            db.add(Wallet(customer_id=c.id, balance=0, is_active=True))
        db.commit()
        db.refresh(c)
        return _customer_to_cardholder(c, c.wallet)

    raise HTTPException(400, f"Unknown kind {kind}")


# ── Sync run + status + audit ───────────────────────────────────────────────


def _run_sync_in_background(sync_log_id: int, sync_type: str) -> None:
    """Worker: opens its own DB session and runs the sync, updating the SyncLog
    row in place (so the polling endpoint sees progress)."""
    db = SessionLocal()
    try:
        from app.services.powerschool_sync import (
            _process_family,
            _select_subset,
            _load_fixture,
            _get_internal_type,
            _upsert_staff,
            _FAILURE_RATE,
        )
        import random

        log = db.query(SyncLog).filter(SyncLog.id == sync_log_id).first()
        if not log:
            return
        rng = random.Random(f"{log.id}-{sync_type}")
        internal_type_id = _get_internal_type(db).id
        target_roles = list(log.target_roles or ["student", "parent", "staff"])
        effective_fault = 0.0  # admin-triggered runs default to clean

        errors: List[str] = []
        total = success = failed = 0

        if "staff" in target_roles:
            staffs = _load_fixture("ps_staffs.json").get("staffs", [])
            for s in _select_subset(staffs, sync_type, rng):
                total += 1
                try:
                    _upsert_staff(db, s, sync_log_id=log.id)
                    success += 1
                except Exception as e:  # pragma: no cover
                    failed += 1
                    errors.append(f"staff {s.get('customerId')}: {e}")
                # Update log periodically so poll sees progress
                if total % 5 == 0:
                    log.records_total = total
                    log.records_success = success
                    log.records_failed = failed
                    db.commit()

        families = _load_fixture("ps_families.json").get("families", [])
        for fam in _select_subset(families, sync_type, rng):
            s, f, errs = _process_family(
                db, fam, target_roles, rng, internal_type_id, effective_fault, sync_log_id=log.id
            )
            total += s + f
            success += s
            failed += f
            errors.extend(errs)
            log.records_total = total
            log.records_success = success
            log.records_failed = failed
            db.commit()

        log.records_total = total
        log.records_success = success
        log.records_failed = failed
        log.finished_at = datetime.utcnow()
        if failed == 0:
            log.status = "success"
        elif success == 0:
            log.status = "failed"
        else:
            log.status = "partial"
        log.error_log = "\n".join(errors[:50]) if errors else None
        db.commit()
    except Exception as e:  # pragma: no cover
        log = db.query(SyncLog).filter(SyncLog.id == sync_log_id).first()
        if log:
            log.status = "failed"
            log.finished_at = datetime.utcnow()
            log.error_log = f"FATAL: {e}"
            db.commit()
    finally:
        db.close()


@router.post("/sync/run", response_model=SyncStatusResponse)
def run_sync_endpoint(
    payload: SyncRunRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Kick off a PowerSchool sync in the background; returns the SyncLog id
    immediately so the UI can poll status. Sync runs pull-only (no writes back
    to the school API)."""
    log = SyncLog(
        sync_type=payload.sync_type,
        target_roles=["student", "parent", "staff"],
        triggered_by=current_user.id,
        status="running",
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    background_tasks.add_task(_run_sync_in_background, log.id, payload.sync_type)
    return SyncStatusResponse(
        sync_log_id=log.id,
        sync_type=log.sync_type,
        status=log.status,
        target_roles=list(log.target_roles or []),
        started_at=log.started_at,
        finished_at=log.finished_at,
        records_total=log.records_total or 0,
        records_success=log.records_success or 0,
        records_failed=log.records_failed or 0,
    )


@router.get("/sync-logs/{sync_log_id}", response_model=SyncStatusResponse)
def get_sync_status(
    sync_log_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    log = db.query(SyncLog).filter(SyncLog.id == sync_log_id).first()
    if not log:
        raise HTTPException(404, "Sync log not found")
    return SyncStatusResponse(
        sync_log_id=log.id,
        sync_type=log.sync_type,
        status=log.status,
        target_roles=list(log.target_roles or []),
        started_at=log.started_at,
        finished_at=log.finished_at,
        records_total=log.records_total or 0,
        records_success=log.records_success or 0,
        records_failed=log.records_failed or 0,
        error_log=log.error_log,
    )


@router.get("/sync-logs", response_model=List[SyncStatusResponse])
def list_sync_logs(
    limit: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    logs = (
        db.query(SyncLog)
        .order_by(SyncLog.started_at.desc())
        .limit(limit)
        .all()
    )
    return [
        SyncStatusResponse(
            sync_log_id=log.id,
            sync_type=log.sync_type,
            status=log.status,
            target_roles=list(log.target_roles or []),
            started_at=log.started_at,
            finished_at=log.finished_at,
            records_total=log.records_total or 0,
            records_success=log.records_success or 0,
            records_failed=log.records_failed or 0,
        )
        for log in logs
    ]


@router.get("/sync-audit/{sync_log_id}", response_model=List[SyncAuditEntry])
def get_sync_audit(
    sync_log_id: int,
    action: Optional[str] = Query(None, description="filter create | update | noop"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    """Per-record diff for a sync run."""
    q = (
        db.query(SyncAuditLog)
        .filter(SyncAuditLog.sync_log_id == sync_log_id)
        .order_by(SyncAuditLog.id.asc())
    )
    if action:
        q = q.filter(SyncAuditLog.action == action)
    return [
        SyncAuditEntry(
            id=row.id,
            sync_log_id=row.sync_log_id,
            entity_type=row.entity_type,
            entity_id=row.entity_id,
            entity_name=row.entity_name,
            external_id=row.external_id,
            action=row.action,
            changes=row.changes,
            created_at=row.created_at,
        )
        for row in q.all()
    ]
