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

router = APIRouter()

SCHOOL_KEYS = {"school_name", "school_address", "school_tax_id", "school_phone", "school_logo_url"}


class SettingUpdate(BaseModel):
    value: Any


class SchoolSettingsUpdate(BaseModel):
    school_name: str = ""
    school_address: str = ""
    school_tax_id: str = ""
    school_phone: str = ""
    school_logo_url: str = ""


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
