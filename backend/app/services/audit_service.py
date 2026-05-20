"""
Audit Service — lightweight helper for logging product price edits and deletions.

Usage:
    from app.services.audit_service import create_audit_log
    create_audit_log(db, "shop_product", product.id, product.name, shop_id,
                     "UPDATE_PRICE", {"old": {...}, "new": {...}}, user_id)
"""
from __future__ import annotations

import json
from typing import Any, Dict, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text


def create_audit_log(
    db: Session,
    entity_type: str,
    entity_id: Optional[int],
    entity_name: Optional[str],
    shop_id: Optional[str],
    action: str,
    changes: Dict[str, Any],
    user_id: int,
) -> None:
    """
    Insert a row into audit_logs.  Uses raw SQL (consistent with project pattern)
    so it works even if the ORM model hasn't been imported/mapped yet.

    Supported actions: UPDATE_PRICE, DELETE_PRODUCT, UPDATE_PRODUCT, CREATE, VOID,
                       UPDATE_BALANCE, UPDATE_SETTING
    changes format:
      UPDATE_PRICE  → {"old": {"external_price": X, "internal_price": Y}, "new": {...}}
      DELETE_PRODUCT → {"snapshot": {"name": ..., "external_price": ..., "stock": ...}}
    """
    # Normalise action: if the value is not yet in the DB enum, fall back to a safe value
    KNOWN_ACTIONS = {
        "create", "update", "delete", "return", "exchange",
        "cancel", "void", "reprint", "approve", "reject",
        "UPDATE_PRICE", "UPDATE_PRODUCT", "DELETE_PRODUCT",
        "UPDATE_BALANCE", "UPDATE_SETTING",
    }
    safe_action = action if action in KNOWN_ACTIONS else "update"

    changes_json = json.dumps(changes, default=str)
    try:
        # Use explicit cast via SQL function to avoid ::jsonb syntax issues with psycopg2
        db.execute(
            text("""
                INSERT INTO audit_logs
                    (entity_type, entity_id, entity_name, shop_id, action, changes_json, user_id)
                VALUES
                    (:entity_type, :entity_id, :entity_name, :shop_id, :action,
                     CAST(:changes_json AS JSONB), :user_id)
            """),
            {
                "entity_type": entity_type,
                "entity_id": entity_id,
                "entity_name": entity_name,
                "shop_id": shop_id,
                "action": safe_action,
                "changes_json": changes_json,
                "user_id": user_id,
            },
        )
    except Exception:
        # Audit log failure must never break the main operation — swallow silently
        db.rollback()
