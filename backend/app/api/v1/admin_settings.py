"""
Admin Settings API — read/write runtime feature flags.

Routes:
    GET  /api/v1/admin/settings/         list all known flags + current values
    PUT  /api/v1/admin/settings/{key}    update a flag (admin only)
"""
from typing import Any, Dict
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import require_role
from app.models.user import User
from app.services.settings_service import KNOWN_FLAGS, SettingsService
from app.services.audit_service import create_audit_log
from app.services import email_service

router = APIRouter()

SCHOOL_KEYS = {"school_name", "school_address", "school_tax_id", "school_phone", "school_logo_url", "school_cover_url"}


class SettingUpdate(BaseModel):
    value: Any


class SchoolSettingsUpdate(BaseModel):
    school_name: str = ""
    school_address: str = ""
    school_tax_id: str = ""
    school_phone: str = ""
    school_logo_url: str = ""
    school_cover_url: str = ""


@router.get("/public", response_model=Dict[str, Any])
def get_public_settings(db: Session = Depends(get_db)):
    """Public endpoint — no auth required. Returns only safe display fields."""
    public_keys = ("school_name", "school_cover_url", "school_logo_url")
    result = {}
    for key in public_keys:
        val = SettingsService.get_raw(db, key)
        result[key] = val if val is not None else KNOWN_FLAGS.get(key, "")
    return result


@router.get("/", response_model=Dict[str, Any])
def list_settings(
    db: Session = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    return SettingsService.list_known(db)


@router.get("/school", response_model=Dict[str, Any])
def get_school_settings(
    db: Session = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    result = {}
    for key in SCHOOL_KEYS:
        val = SettingsService.get_raw(db, key)
        result[key] = val if val is not None else KNOWN_FLAGS.get(key, "")
    return result


@router.put("/school", response_model=Dict[str, Any])
def update_school_settings(
    body: SchoolSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    updates = body.model_dump()
    for key, value in updates.items():
        SettingsService.set(db, key, value, current_user.id)
    return updates


@router.put("/{key}", response_model=Dict[str, Any])
def update_setting(
    key: str,
    body: SettingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    if key not in KNOWN_FLAGS and key not in SCHOOL_KEYS:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown setting key '{key}'",
        )
    old_value = SettingsService.get_raw(db, key)
    new_value = SettingsService.set(db, key, body.value, current_user.id)
    # Audit trail — feature-flag changes are sensitive enough to track
    create_audit_log(
        db,
        entity_type="system_setting",
        entity_id=None,
        entity_name=key,
        shop_id=None,
        action="UPDATE_SETTING",
        changes={"old": old_value, "new": new_value},
        user_id=current_user.id,
    )
    db.commit()
    return {"key": key, "value": new_value}


class TestEmailRequest(BaseModel):
    to: str | None = None


@router.post("/test-email")
def test_email(
    body: TestEmailRequest | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    """Send a one-shot test email to validate SMTP credentials.

    Defaults to the current user's email on file but accepts a `to` override
    in the body so operators can target an inbox they actually monitor.
    Returns the SMTP error verbatim on failure so provider config can be
    debugged from the API.
    """
    recipient = ((body and body.to) or current_user.email or "").strip()
    if not recipient or "@" not in recipient:
        raise HTTPException(
            status_code=400,
            detail="No valid recipient — pass {'to': 'name@domain.com'} in body or set the user's email",
        )
    if not email_service.is_configured():
        raise HTTPException(
            status_code=503,
            detail="SMTP not configured — set SMTP_HOST / SMTP_USERNAME / SMTP_PASSWORD env vars",
        )

    subject = "✅ [ISB] Test email — SMTP configuration works"
    html = (
        "<div style='font-family:system-ui,sans-serif;padding:24px;max-width:480px;'>"
        f"<h2 style='color:#1f2937;margin:0 0 12px;'>SMTP test successful</h2>"
        f"<p style='color:#374151;line-height:1.6;'>Hello "
        f"<strong>{current_user.full_name or current_user.username}</strong>,</p>"
        "<p style='color:#374151;line-height:1.6;'>"
        "This is a test message sent from the ISB POS system to confirm that "
        "your SMTP settings are configured correctly. You can now receive "
        "low-balance alerts and other transactional emails."
        "</p>"
        "</div>"
    )
    try:
        email_service.send_email(to=recipient, subject=subject, body_html=html)
        return {"sent": True, "to": recipient}
    except email_service.EmailDeliveryError as exc:
        raise HTTPException(status_code=502, detail=f"SMTP delivery failed: {exc}")
