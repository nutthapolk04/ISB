"""
Mock PowerSchool sync service (Phase 3.5b — fixture-based).

Upserts from two bundled fixture files that match the exact JSON shape
the PowerSchool middleware sends (see `fixtures/ps_staffs.json` and
`fixtures/ps_families.json`). When the middleware is wired up for real,
replace `_load_fixture()` with an HTTP fetch and the rest stays.

`delta` → touch ~60% of target records (simulated partial update)
`full`  → touch 100%
Failure rate ≈ 8% (deterministic per sync run via RNG seed)
"""
from __future__ import annotations
import base64
import hashlib
import io
import json
import logging
import random
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from app.core.security import get_password_hash
from app.models.customer import Customer, CustomerType, CustomerTypeEnum
from app.models.family_profile import FamilyProfile
from app.models.parent_child_link import ParentChildLink
from app.models.sync_log import SyncLog
from app.models.sync_audit_log import SyncAuditLog


# Significant fields tracked in sync audit (significant = admin-meaningful;
# excludes timestamps, photo_url rotations, and computed fields to keep audit
# rows readable).
USER_AUDIT_FIELDS = (
    "full_name", "email", "role", "customer_type", "family_code",
    "card_uid", "status", "shop_id",
)
CUSTOMER_AUDIT_FIELDS = (
    "name", "email", "family_code", "customer_type", "customer_kind",
    "card_uid", "grade", "school_type", "external_id",
)


def _snapshot(entity, fields) -> Dict[str, Any]:
    return {f: getattr(entity, f, None) for f in fields}


def _emit_audit(
    db: Session,
    sync_log_id: Optional[int],
    entity_type: str,
    entity,
    before: Dict[str, Any],
    fields,
    *,
    created: bool,
) -> None:
    """Compare snapshots and append a SyncAuditLog row (skip if no sync_log_id)."""
    if not sync_log_id:
        return
    after = _snapshot(entity, fields)
    if created:
        action = "create"
        changes = {k: {"old": None, "new": after[k]} for k in fields if after[k] is not None}
    else:
        diff = {
            k: {"old": before[k], "new": after[k]}
            for k in fields
            if before.get(k) != after[k]
        }
        action = "update" if diff else "noop"
        changes = diff or None

    name = getattr(entity, "full_name", None) or getattr(entity, "name", None)
    ext_id = getattr(entity, "external_id", None)
    db.add(SyncAuditLog(
        sync_log_id=sync_log_id,
        entity_type=entity_type,
        entity_id=entity.id,
        entity_name=name,
        external_id=str(ext_id) if ext_id else None,
        action=action,
        changes=changes,
    ))
from app.models.user import User
from app.models.wallet import Wallet


_FIXTURE_DIR = Path(__file__).parent / "fixtures"
# ── Realistic mock portraits ─────────────────────────────────────────────────
# Curated randomuser.me portraits — different indices per role keep each pool
# visually distinct so Staff / Parent / Student / Visitor tabs feel diverse.
# Production replaces these with Cloudinary URLs from photoBase64 payloads.

_STAFF_PORTRAITS = [
    "https://randomuser.me/api/portraits/men/32.jpg",
    "https://randomuser.me/api/portraits/women/44.jpg",
    "https://randomuser.me/api/portraits/men/45.jpg",
    "https://randomuser.me/api/portraits/women/65.jpg",
    "https://randomuser.me/api/portraits/men/78.jpg",
    "https://randomuser.me/api/portraits/women/12.jpg",
    "https://randomuser.me/api/portraits/men/91.jpg",
    "https://randomuser.me/api/portraits/women/29.jpg",
]

_PARENT_PORTRAITS = [
    "https://randomuser.me/api/portraits/men/11.jpg",
    "https://randomuser.me/api/portraits/women/27.jpg",
    "https://randomuser.me/api/portraits/men/59.jpg",
    "https://randomuser.me/api/portraits/women/38.jpg",
    "https://randomuser.me/api/portraits/men/83.jpg",
    "https://randomuser.me/api/portraits/women/71.jpg",
    "https://randomuser.me/api/portraits/men/14.jpg",
    "https://randomuser.me/api/portraits/women/5.jpg",
]

_STUDENT_PORTRAITS = [
    # Younger-looking portraits — production photos come from PS photoBase64
    "https://randomuser.me/api/portraits/women/1.jpg",
    "https://randomuser.me/api/portraits/women/2.jpg",
    "https://randomuser.me/api/portraits/men/3.jpg",
    "https://randomuser.me/api/portraits/women/4.jpg",
    "https://randomuser.me/api/portraits/men/6.jpg",
    "https://randomuser.me/api/portraits/women/8.jpg",
    "https://randomuser.me/api/portraits/men/9.jpg",
    "https://randomuser.me/api/portraits/women/10.jpg",
]

_VISITOR_PORTRAITS = [
    "https://randomuser.me/api/portraits/men/22.jpg",
    "https://randomuser.me/api/portraits/women/55.jpg",
    "https://randomuser.me/api/portraits/men/66.jpg",
    "https://randomuser.me/api/portraits/women/77.jpg",
    "https://randomuser.me/api/portraits/men/88.jpg",
    "https://randomuser.me/api/portraits/women/92.jpg",
]

_PORTRAIT_POOLS: Dict[str, List[str]] = {
    "staff": _STAFF_PORTRAITS,
    "parent": _PARENT_PORTRAITS,
    "student": _STUDENT_PORTRAITS,
    "visitor": _VISITOR_PORTRAITS,
}


def _realistic_photo(role: str, seed: str) -> str:
    """Return a deterministic realistic portrait URL for the given role+seed.

    Same ``seed`` → same photo, so re-syncing doesn't shuffle faces. Roles
    that aren't in the pool (admin/manager/cashier/other) reuse Staff.
    """
    pool = _PORTRAIT_POOLS.get(role, _STAFF_PORTRAITS)
    h = int(hashlib.md5(seed.encode()).hexdigest(), 16)
    return pool[h % len(pool)]


def _resolve_photo_url(
    payload: Dict[str, Any],
    cloudinary_code: str,
    role: str,
    ext_id: str,
    existing_url: Optional[str],
) -> str:
    """Decode `photoBase64` from PS payload → upload to Cloudinary → return URL.

    Falls back to the existing URL (or a realistic portrait seeded by ext_id)
    on any error so a flaky photo pipeline never blocks the rest of the sync.
    """
    b64 = payload.get("photoBase64") or payload.get("photo_base64")
    if not b64:
        return existing_url or _realistic_photo(role, ext_id)

    # Strip data URI prefix if present: "data:image/jpeg;base64,..."
    if "," in b64:
        b64 = b64.split(",", 1)[1]

    try:
        binary = base64.b64decode(b64, validate=True)
    except Exception as e:
        logger.warning("Invalid photoBase64 for %s: %s — keeping existing URL", ext_id, e)
        return existing_url or _realistic_photo(role, ext_id)

    try:
        from app.services.upload_service import upload_student_photo
        return upload_student_photo(io.BytesIO(binary), cloudinary_code)
    except Exception as e:
        logger.warning(
            "Cloudinary upload failed for %s (code=%s): %s — keeping existing URL",
            ext_id, cloudinary_code, e,
        )
        return existing_url or _realistic_photo(role, ext_id)
_PARENT_DEFAULT_PASSWORD = "parent"   # mock SSO — demo only
_FAILURE_RATE = 0.08


# ── fixture loading ──────────────────────────────────────────────────────────


def _load_fixture(name: str) -> Dict[str, Any]:
    path = _FIXTURE_DIR / name
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


# ── helpers ──────────────────────────────────────────────────────────────────


def _get_internal_type(db: Session) -> CustomerType:
    ct = db.query(CustomerType).filter(CustomerType.type_name == CustomerTypeEnum.INTERNAL).first()
    if not ct:
        ct = CustomerType(
            type_name=CustomerTypeEnum.INTERNAL,
            description="Student/staff internal customer",
            default_price_level="internal",
        )
        db.add(ct)
        db.flush()
    return ct


def _upsert_family_profile(
    db: Session, family_code: str, notification_emails: List[str], login_ids: List[str]
) -> FamilyProfile:
    fp = db.query(FamilyProfile).filter(FamilyProfile.family_code == family_code).first()
    if fp:
        fp.notification_emails = notification_emails
        fp.login_ids = login_ids
        fp.last_synced_at = datetime.utcnow()
    else:
        fp = FamilyProfile(
            family_code=family_code,
            notification_emails=notification_emails,
            login_ids=login_ids,
            last_synced_at=datetime.utcnow(),
        )
        db.add(fp)
    return fp


def _upsert_link(
    db: Session, parent: User, child: Customer, parent_rank: str, relation: str = "guardian"
) -> None:
    link = (
        db.query(ParentChildLink)
        .filter(
            ParentChildLink.parent_user_id == parent.id,
            ParentChildLink.child_customer_id == child.id,
        )
        .first()
    )
    if link:
        link.parent_rank = parent_rank
        if relation and link.relation == "guardian":
            link.relation = relation
    else:
        db.add(
            ParentChildLink(
                parent_user_id=parent.id,
                child_customer_id=child.id,
                relation=relation,
                parent_rank=parent_rank,
            )
        )


# ── entity upserts ───────────────────────────────────────────────────────────


def _upsert_staff(
    db: Session, payload: Dict[str, Any], sync_log_id: Optional[int] = None
) -> Tuple[User, bool]:
    """Upsert a Staff entry. Returns (user, created)."""
    ext_id = str(payload["customerId"])
    email = payload["login"]["email"].strip().lower()
    username = payload["login"]["loginId"].split("@")[0].strip().lower()
    full_name = f"{payload['firstName']} {payload['lastName']}".strip()
    family_code = str(payload["familyCode"])
    card_uid = payload.get("smartCard", {}).get("cardNumber")

    # Match priority: external_id → email → username (idempotent upsert)
    user = (
        db.query(User)
        .filter(User.external_id == ext_id)
        .first()
    )
    if not user:
        user = db.query(User).filter(User.email == email).first()
    if not user:
        user = db.query(User).filter(User.username == username).first()

    created = user is None
    before = _snapshot(user, USER_AUDIT_FIELDS) if user else {}
    if created:
        user = User(
            username=username,
            email=email,
            full_name=full_name,
            hashed_password=get_password_hash(_PARENT_DEFAULT_PASSWORD),
            is_active=True,
            is_superuser=False,
            role="staff",
            status="active",
        )
        db.add(user)

    user.external_id = ext_id
    user.family_code = family_code
    user.full_name = full_name
    user.customer_type = "Staff"
    user.staff_type = payload.get("staffType")
    user.ps_department = payload.get("department")
    if card_uid:
        user.card_uid = card_uid
    user.photo_url = _resolve_photo_url(payload, f"staff-{ext_id}", "staff", ext_id, user.photo_url)
    user.last_synced_at = datetime.utcnow()
    db.flush()  # ensure user.id available for audit
    _emit_audit(db, sync_log_id, "user", user, before, USER_AUDIT_FIELDS, created=created)
    return user, created


def _upsert_parent(
    db: Session,
    payload: Dict[str, Any],
    family_code: str,
    login_hint: Optional[str],
    sync_log_id: Optional[int] = None,
) -> Tuple[User, bool]:
    """Upsert a Parent entry (customerType='Parent'). login_hint is one of family.login[]."""
    ext_id = str(payload["customerId"])
    full_name = f"{payload['firstName']} {payload['lastName']}".strip()
    card_uid = payload.get("smartCard", {}).get("cardNumber")

    # Choose email: prefer login_hint (matches PS login array), else {customerId}@parents.isb.ac.th
    email = (login_hint or f"{ext_id}@parents.isb.ac.th").strip().lower()
    username = email.split("@")[0].strip().lower()

    user = db.query(User).filter(User.external_id == ext_id).first()
    if not user:
        user = db.query(User).filter(User.email == email).first()

    created = user is None
    before = _snapshot(user, USER_AUDIT_FIELDS) if user else {}
    if created:
        user = User(
            username=username,
            email=email,
            full_name=full_name,
            hashed_password=get_password_hash(_PARENT_DEFAULT_PASSWORD),
            is_active=True,
            is_superuser=False,
            role="parent",
            status="active",
        )
        db.add(user)

    user.external_id = ext_id
    user.family_code = family_code
    user.full_name = full_name
    user.customer_type = "Parent"
    user.role = "parent"  # ensure role stays parent
    if card_uid:
        user.card_uid = card_uid
    user.photo_url = _resolve_photo_url(payload, f"parent-{ext_id}", "parent", ext_id, user.photo_url)
    user.last_synced_at = datetime.utcnow()
    db.flush()
    _emit_audit(db, sync_log_id, "user", user, before, USER_AUDIT_FIELDS, created=created)
    return user, created


def _upsert_staff_parent_reference(
    db: Session,
    payload: Dict[str, Any],
    family_code: str,
    sync_log_id: Optional[int] = None,
) -> Optional[User]:
    """
    When a family's mainParent/secondaryParent has customerType='Staff',
    the staff record should already exist from staff fixture. Just update
    family_code so family resolver picks them up.
    """
    ext_id = str(payload["customerId"])
    user = db.query(User).filter(User.external_id == ext_id).first()
    created = user is None
    before = _snapshot(user, USER_AUDIT_FIELDS) if user else {}
    if created:
        # Staff fixture may not have been synced yet in this run — upsert minimally.
        full_name = f"{payload['firstName']} {payload['lastName']}".strip()
        email = f"{payload.get('firstName', 'staff').lower()}{ext_id}@isb.ac.th"
        user = User(
            username=f"staff_{ext_id}",
            email=email,
            full_name=full_name,
            hashed_password=get_password_hash(_PARENT_DEFAULT_PASSWORD),
            is_active=True,
            is_superuser=False,
            role="staff",
            status="active",
            external_id=ext_id,
            customer_type="Staff",
        )
        db.add(user)

    user.family_code = family_code
    card_uid = payload.get("smartCard", {}).get("cardNumber")
    if card_uid:
        user.card_uid = card_uid
    user.last_synced_at = datetime.utcnow()
    db.flush()
    _emit_audit(db, sync_log_id, "user", user, before, USER_AUDIT_FIELDS, created=created)
    return user


def _upsert_student(
    db: Session,
    payload: Dict[str, Any],
    family_code: str,
    internal_type_id: int,
    sync_log_id: Optional[int] = None,
) -> Tuple[Customer, bool]:
    """Upsert a Student Customer entry."""
    ext_id = str(payload["customerId"])
    full_name = f"{payload['firstName']} {payload['lastName']}".strip()
    grade = payload.get("grade")
    school_type = payload.get("schoolType")
    card_uid = payload.get("smartCard", {}).get("cardNumber")

    customer = (
        db.query(Customer)
        .filter(Customer.external_id == ext_id)
        .first()
    )
    if not customer:
        customer = db.query(Customer).filter(Customer.student_code == ext_id).first()

    created = customer is None
    before = _snapshot(customer, CUSTOMER_AUDIT_FIELDS) if customer else {}
    if created:
        customer = Customer(
            customer_code=f"PS-{ext_id}",
            student_code=ext_id,
            name=full_name,
            customer_type_id=internal_type_id,
            is_active=True,
            card_frozen=False,
            customer_kind="student",
        )
        db.add(customer)
        db.flush()
        # Create wallet with demo balance
        db.add(Wallet(customer_id=customer.id, balance=500, is_active=True))

    customer.external_id = ext_id
    customer.family_code = family_code
    customer.name = full_name
    customer.grade = grade
    customer.school_type = school_type
    customer.customer_type = "Student"
    customer.customer_kind = "student"
    if card_uid:
        customer.card_uid = card_uid
    customer.photo_url = _resolve_photo_url(
        payload, customer.customer_code, "student", ext_id, customer.photo_url
    )
    customer.powerschool_sync_at = datetime.utcnow()
    db.flush()
    _emit_audit(db, sync_log_id, "customer", customer, before, CUSTOMER_AUDIT_FIELDS, created=created)

    # Ensure a Student User account exists so the student can log in to view
    # their wallet & transactions. Username = student_code (PS ID); password
    # defaults to the demo password — admins can rotate it from the UI.
    existing_student_user = db.query(User).filter(User.username == ext_id).first()
    if not existing_student_user:
        student_user = User(
            username=ext_id,
            email=f"{ext_id}@students.isb.ac.th",
            full_name=full_name,
            hashed_password=get_password_hash(_PARENT_DEFAULT_PASSWORD),
            is_active=True,
            is_superuser=False,
            role="student",
            status="active",
            customer_type="Student",
            external_id=ext_id,
            family_code=family_code,
            photo_url=customer.photo_url,
            last_synced_at=datetime.utcnow(),
        )
        db.add(student_user)
        db.flush()

    return customer, created


# ── sync orchestration ───────────────────────────────────────────────────────


def _select_subset(items: List[Any], sync_type: str, rng: random.Random) -> List[Any]:
    if sync_type == "full":
        return items
    return [x for x in items if rng.random() < 0.6]


def _process_family(
    db: Session,
    family: Dict[str, Any],
    target_roles: List[str],
    rng: random.Random,
    internal_type_id: int,
    fault_rate: float,
    sync_log_id: Optional[int] = None,
) -> Tuple[int, int, List[str]]:
    """Process one family record. Returns (success_count, fail_count, errors)."""
    success = failed = 0
    errors: List[str] = []
    family_code = str(family["familyCode"])

    # Always upsert family_profile (counts as its own "record" for totals)
    try:
        _upsert_family_profile(
            db,
            family_code,
            list(family.get("notificationEmails", []) or []),
            list(family.get("login", []) or []),
        )
        success += 1
    except Exception as e:
        failed += 1
        errors.append(f"family_profile {family_code}: {e}")

    # Parents (mainParent, secondaryParent) — respect target_roles
    login_array = list(family.get("login", []) or [])
    parents_with_rank = []
    if family.get("mainParent"):
        parents_with_rank.append(("main", family["mainParent"]))
    if family.get("secondaryParent"):
        parents_with_rank.append(("secondary", family["secondaryParent"]))

    parent_user_rows: List[Tuple[User, str]] = []
    for idx, (rank, p_payload) in enumerate(parents_with_rank):
        ctype = p_payload.get("customerType", "Parent")
        role_key = "staff" if ctype == "Staff" else "parent"
        if role_key not in target_roles:
            continue

        # Simulate failure
        if rng.random() < fault_rate:
            failed += 1
            errors.append(f"Validation error: {role_key} #{p_payload.get('customerId')} ({family_code})")
            continue

        try:
            if ctype == "Staff":
                user = _upsert_staff_parent_reference(db, p_payload, family_code, sync_log_id)
            else:
                login_hint = login_array[idx] if idx < len(login_array) else None
                user, _ = _upsert_parent(db, p_payload, family_code, login_hint, sync_log_id)
            parent_user_rows.append((user, rank))
            success += 1
        except Exception as e:
            failed += 1
            errors.append(f"parent {p_payload.get('customerId')}: {e}")

    # Students
    if "student" in target_roles:
        db.flush()  # make sure parent rows have ids for linking
        for s_payload in family.get("students", []) or []:
            if rng.random() < fault_rate:
                failed += 1
                errors.append(f"Invalid grade for student #{s_payload.get('customerId')}")
                continue
            try:
                student, _ = _upsert_student(db, s_payload, family_code, internal_type_id, sync_log_id)
                db.flush()
                for parent_user, rank in parent_user_rows:
                    _upsert_link(db, parent_user, student, rank)
                success += 1
            except Exception as e:
                failed += 1
                errors.append(f"student {s_payload.get('customerId')}: {e}")

    return success, failed, errors


def run_sync(
    db: Session,
    triggered_by_id: Optional[int],
    sync_type: str = "delta",
    target_roles: Optional[List[str]] = None,
    fault_rate: Optional[float] = None,
) -> SyncLog:
    """Execute a mock PowerSchool sync from bundled fixtures. Idempotent.

    `fault_rate` overrides the default 8% fault injection. Pass 0.0 from
    seed scripts to force a clean full load.
    """
    target_roles = target_roles or ["student", "parent", "staff"]
    effective_fault = _FAILURE_RATE if fault_rate is None else fault_rate

    log = SyncLog(
        sync_type=sync_type,
        target_roles=list(target_roles),
        triggered_by=triggered_by_id,
        status="running",
    )
    db.add(log)
    db.flush()

    rng = random.Random(f"{log.id}-{sync_type}")
    internal_type_id = _get_internal_type(db).id
    errors: List[str] = []
    total = success = failed = 0

    # ── Staff fixture (only if "staff" in target_roles) ──────────────────
    if "staff" in target_roles:
        staffs = _load_fixture("ps_staffs.json").get("staffs", [])
        staffs_subset = _select_subset(staffs, sync_type, rng)
        for s in staffs_subset:
            total += 1
            if rng.random() < effective_fault:
                failed += 1
                errors.append(f"Validation error: staff #{s.get('customerId')} missing email")
                continue
            try:
                _upsert_staff(db, s, sync_log_id=log.id)
                success += 1
            except Exception as e:
                failed += 1
                errors.append(f"staff {s.get('customerId')}: {e}")

    # ── Family fixture (parents + students + family_profile) ─────────────
    families = _load_fixture("ps_families.json").get("families", [])
    families_subset = _select_subset(families, sync_type, rng)
    for fam in families_subset:
        s, f, errs = _process_family(db, fam, target_roles, rng, internal_type_id, effective_fault, sync_log_id=log.id)
        total += s + f
        success += s
        failed += f
        errors.extend(errs)

    # Finalize log
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
    db.refresh(log)
    return log
