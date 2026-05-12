"""
Customer (Student) Pydantic Schemas
"""
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field


class StudentProfileResponse(BaseModel):
    """Full student profile — used by cashier lookup and parent profile view."""
    id: int
    customer_code: str
    student_code: Optional[str] = None
    name: str
    grade: Optional[str] = None
    school_type: Optional[str] = None
    customer_kind: Optional[str] = None
    photo_url: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    allergies: Optional[str] = None
    dietary_notes: Optional[str] = None
    allergy_override_note: Optional[str] = None
    card_uid: Optional[str] = None
    card_frozen: bool = False
    daily_limit: Optional[float] = None
    negative_credit_limit: Optional[float] = None
    external_id: Optional[str] = None
    family_code: Optional[str] = None
    # Wallet summary
    wallet_id: Optional[int] = None
    wallet_balance: Optional[float] = None


class FreezeCardRequest(BaseModel):
    frozen: bool


class DailyLimitRequest(BaseModel):
    daily_limit: Optional[float] = Field(None, ge=0)


class NegativeCreditLimitRequest(BaseModel):
    negative_credit_limit: Optional[float] = Field(None, ge=0, description="Max overdraft allowed (THB). null = no overdraft allowed.")


class AllergyUpdateRequest(BaseModel):
    allergies: Optional[str] = None
    dietary_notes: Optional[str] = None
    allergy_override_note: Optional[str] = None


class CardBindRequest(BaseModel):
    card_uid: Optional[str] = Field(None, description="NFC card UID. null to unbind.")


class GraduateRequest(BaseModel):
    transfer_to_customer_id: Optional[int] = Field(
        None, description="Sibling to receive remaining wallet balance. Auto-pick if single sibling and not specified."
    )


class GraduateResponse(BaseModel):
    customer_id: int
    deactivated: bool
    transferred_to_customer_id: Optional[int] = None
    transferred_amount: float = 0.0
    siblings_available: list[int] = []
    message: str


class CreateStudentRequest(BaseModel):
    customer_code: str
    name: str
    student_code: Optional[str] = None
    grade: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    allergies: Optional[str] = None
    dietary_notes: Optional[str] = None
    card_uid: Optional[str] = None
    photo_url: Optional[str] = None
    customer_type_id: Optional[int] = None
    initial_balance: float = 0


# ── Unified Cardholder API schemas ───────────────────────────────────────────

CardholderKind = Literal["student", "parent", "staff", "department", "other"]


class CardholderResponse(BaseModel):
    """Unified row for the /admin/cardholders list — covers User + Customer + Department."""
    key: str  # composite "u-123" / "c-456" / "d-7"
    kind: CardholderKind
    entity_type: Literal["user", "customer", "department"]
    entity_id: int
    name: str
    identifier: str  # username | customer_code | student_code | department_code
    photo_url: Optional[str] = None
    family_code: Optional[str] = None
    external_id: Optional[str] = None
    card_uid: Optional[str] = None
    wallet_id: Optional[int] = None
    wallet_balance: Optional[float] = None
    is_active: bool = True
    role: Optional[str] = None  # for users
    shop_id: Optional[str] = None
    grade: Optional[str] = None
    school_type: Optional[str] = None
    allergies: Optional[str] = None
    department_code: Optional[str] = None
    synced_at: Optional[datetime] = None


class CardholderListResponse(BaseModel):
    items: List[CardholderResponse]
    total: int


class CreateCardholderRequest(BaseModel):
    """Discriminated by `kind` — extra fields are interpreted per kind."""
    kind: CardholderKind
    # Common
    name: Optional[str] = None
    family_code: Optional[str] = None
    card_uid: Optional[str] = None
    # Student
    customer_code: Optional[str] = None
    student_code: Optional[str] = None
    grade: Optional[str] = None
    school_type: Optional[str] = None
    initial_balance: Optional[float] = 0
    # Parent / Staff
    username: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None  # cashier | manager | kitchen | staff
    shop_id: Optional[str] = None
    # Department
    department_code: Optional[str] = None
    department_name: Optional[str] = None
    initial_credit: Optional[float] = 0
    # Other
    phone: Optional[str] = None
    with_wallet: bool = False


# ── Sync schemas ─────────────────────────────────────────────────────────────


class SyncRunRequest(BaseModel):
    sync_type: Literal["full", "delta"] = "full"


class SyncStatusResponse(BaseModel):
    sync_log_id: int
    sync_type: str
    status: str  # running | success | partial | failed
    target_roles: List[str] = []
    started_at: datetime
    finished_at: Optional[datetime] = None
    records_total: int = 0
    records_success: int = 0
    records_failed: int = 0
    error_log: Optional[str] = None


class SyncAuditEntry(BaseModel):
    id: int
    sync_log_id: int
    entity_type: str
    entity_id: int
    entity_name: Optional[str] = None
    external_id: Optional[str] = None
    action: str  # create | update | noop
    changes: Optional[Dict[str, Any]] = None
    created_at: datetime
