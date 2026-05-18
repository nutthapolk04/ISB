"""
SettingsService — read-through cache over system_settings table.

Used for runtime-toggleable behaviour flags (e.g. negative-balance policy).
Values are stored as JSON-encoded strings for forward compatibility.

Cache strategy: 30-second TTL. This is a deliberate trade-off for multi-worker
deploys (gunicorn N workers, fly.io scale): each worker has its own in-memory
cache, so admin toggles only fully propagate after the TTL expires. 30s is
short enough that admin changes feel responsive, long enough that hot paths
(POS checkout) don't hammer the DB for every request.
"""
from __future__ import annotations

import json
import threading
import time
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.models.system_setting import SystemSetting


# Known flags + their typed defaults. Anything not listed here is still readable
# via get_raw() but not part of the public catalog.
KNOWN_FLAGS: Dict[str, Any] = {
    # Negative-balance policy. Department wallets always allow negative — these
    # flags only gate user/customer wallets. Default OFF (no negative).
    "allow_negative_user_wallet": False,
    "allow_negative_customer_wallet": False,
    # School information — used on receipts and documents
    "school_name": "International School Bangkok",
    "school_address": "",
    "school_tax_id": "",
    "school_phone": "",
    "school_logo_url": "",   # stores base64 data URL or external URL
}


_CACHE: Dict[str, Any] = {}
_LOCK = threading.RLock()
_LOADED_AT: float = 0.0
_TTL_SECONDS = 30.0


def _coerce(raw_json: str, default: Any) -> Any:
    """Best-effort JSON decode; fall back to the raw string if invalid."""
    try:
        return json.loads(raw_json)
    except (ValueError, TypeError):
        return raw_json if raw_json is not None else default


def _ensure_loaded(db: Session) -> None:
    """Reload cache from DB if first access or TTL expired."""
    global _LOADED_AT
    now = time.monotonic()
    if now - _LOADED_AT < _TTL_SECONDS:
        return
    with _LOCK:
        # Double-check inside the lock — another thread may have refreshed.
        if time.monotonic() - _LOADED_AT < _TTL_SECONDS:
            return
        rows = db.query(SystemSetting).all()
        _CACHE.clear()
        for row in rows:
            _CACHE[row.key] = _coerce(row.value, None)
        _LOADED_AT = time.monotonic()


def _invalidate(key: Optional[str] = None) -> None:
    """Force the next read to refetch from DB (used after writes)."""
    global _LOADED_AT
    with _LOCK:
        if key is None:
            _CACHE.clear()
        else:
            _CACHE.pop(key, None)
        _LOADED_AT = 0.0


class SettingsService:
    @staticmethod
    def get_bool(db: Session, key: str, default: bool) -> bool:
        _ensure_loaded(db)
        with _LOCK:
            if key in _CACHE:
                val = _CACHE[key]
                if isinstance(val, bool):
                    return val
                if isinstance(val, str):
                    return val.strip().lower() in ("true", "1", "yes", "on")
                return bool(val)
        return default

    @staticmethod
    def get_raw(db: Session, key: str) -> Optional[Any]:
        _ensure_loaded(db)
        with _LOCK:
            return _CACHE.get(key)

    @staticmethod
    def list_known(db: Session) -> Dict[str, Any]:
        """Return a dict of all known flags with their current value (or default)."""
        _ensure_loaded(db)
        result: Dict[str, Any] = {}
        with _LOCK:
            for key, default in KNOWN_FLAGS.items():
                result[key] = _CACHE.get(key, default)
        return result

    @staticmethod
    def set(db: Session, key: str, value: Any, user_id: Optional[int]) -> Any:
        encoded = json.dumps(value)
        row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        if row is None:
            row = SystemSetting(key=key, value=encoded, updated_by=user_id)
            db.add(row)
        else:
            row.value = encoded
            row.updated_by = user_id
        db.commit()
        db.refresh(row)
        with _LOCK:
            _CACHE[key] = value
        return value
