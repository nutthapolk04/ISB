"""
Audit Service — lightweight helper for logging product price edits and deletions.

Usage:
    from app.services.audit_service import create_audit_log
    create_audit_log(db, "shop_product", product.id, product.name, shop_id,
                     "UPDATE_PRICE", {"old": {...}, "new": {...}}, user_id)
"""
from __future__ import annotations

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

    Supported actions: UPDATE_PRICE, DELETE_PRODUCT, UPDATE_PRODUCT
    changes format:
      UPDATE_PRICE  → {"old": {"external_price": X, "internal_price": Y}, "new": {...}}
      DELETE_PRODUCT → {"snapshot": {"name": ..., "external_price": ..., "stock": ...}}
    """
    import json
    db.execute(
        text("""
            INSERT INTO audit_logs
                (entity_type, entity_id, entity_name, shop_id, action, changes_json, user_id)
            VALUES
                (:entity_type, :entity_id, :entity_name, :shop_id, :action, :changes_json::jsonb, :user_id)
        """),
        {
            "entity_type": entity_type,
            "entity_id": entity_id,
            "entity_name": entity_name,
            "shop_id": shop_id,
            "action": action,
            "changes_json": json.dumps(changes, default=str),
            "user_id": user_id,
        },
    )
