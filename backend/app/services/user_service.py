"""
User service for shop-scoped user management (Sitemap v2).

Handles search/pagination, create, update and delete for users. Used by the
`/api/v1/users` endpoints; permission gating happens at the router level.
"""
from __future__ import annotations

from typing import List, Optional, Tuple

from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.core.security import get_password_hash
from app.models.shop import Shop
from app.models.user import User
from app.schemas.user import UserCreate, UserResponse, UserUpdate

# Roles that get a personal wallet auto-provisioned at creation time.
WALLET_ROLES = {"parent", "staff", "cashier", "manager", "kitchen", "admin"}


class UserService:
    """Static helpers around the `users` table for the management API."""

    # ── Queries ──────────────────────────────────────────────────────────

    @staticmethod
    def list_users(
        db: Session,
        *,
        q: Optional[str] = None,
        shop_id: Optional[str] = None,
        role: Optional[str] = None,
        unassigned: bool = False,
        page: int = 1,
        page_size: int = 50,
    ) -> Tuple[List[UserResponse], int]:
        """Return (items, total) for the given filters."""
        query = db.query(User).options(joinedload(User.shop))

        if q:
            pattern = f"%{q.strip()}%"
            query = query.filter(
                or_(
                    User.username.ilike(pattern),
                    User.full_name.ilike(pattern),
                    User.email.ilike(pattern),
                )
            )
        if role:
            query = query.filter(User.role == role)
        if unassigned:
            query = query.filter(User.shop_id.is_(None))
        elif shop_id:
            query = query.filter(User.shop_id == shop_id)

        total = query.count()

        page = max(1, int(page or 1))
        page_size = max(1, min(500, int(page_size or 50)))
        rows = (
            query.order_by(User.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return [UserService._user_to_response(u) for u in rows], total

    @staticmethod
    def get_user(db: Session, user_id: int) -> Optional[User]:
        return (
            db.query(User)
            .options(joinedload(User.shop))
            .filter(User.id == user_id)
            .first()
        )

    # ── Mutations ────────────────────────────────────────────────────────

    @staticmethod
    def create_user(
        db: Session, payload: UserCreate, *, created_by: User
    ) -> UserResponse:
        """Create a new user. external_id is always None so PowerSchool
        sync will not overwrite manager-created accounts."""
        existing = (
            db.query(User).filter(User.username == payload.username).first()
        )
        if existing:
            raise ValueError(f"Username '{payload.username}' already exists")

        email = payload.email or f"{payload.username}@isb-coop.local"
        if db.query(User).filter(User.email == email).first():
            raise ValueError(f"Email '{email}' already exists")

        if payload.shop_id:
            shop = db.query(Shop).filter(Shop.id == payload.shop_id).first()
            if not shop:
                raise ValueError(f"Shop '{payload.shop_id}' not found")

        user = User(
            username=payload.username,
            email=email,
            full_name=payload.full_name,
            hashed_password=get_password_hash(payload.password),
            role=payload.role,
            shop_id=payload.shop_id,
            is_active=True,
            is_superuser=(payload.role == "admin"),
            external_id=None,  # keep null so PS sync can't clobber this row
            status="active",
        )
        db.add(user)
        db.flush()  # populate user.id without committing yet
        if user.role in WALLET_ROLES:
            # Local import avoids a circular dependency with wallet_service.
            from app.services.wallet_service import WalletService
            WalletService.ensure_wallet_for_user(db, user.id)
        db.commit()
        db.refresh(user)
        return UserService._user_to_response(user)

    @staticmethod
    def update_user(
        db: Session, user_id: int, payload: UserUpdate, *, actor: User
    ) -> UserResponse:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise LookupError("User not found")

        data = payload.model_dump(exclude_unset=True)

        if "shop_id" in data:
            new_shop_id = data["shop_id"]
            if new_shop_id:
                shop = db.query(Shop).filter(Shop.id == new_shop_id).first()
                if not shop:
                    raise ValueError(f"Shop '{new_shop_id}' not found")
            user.shop_id = new_shop_id

        if "role" in data and data["role"] is not None:
            user.role = data["role"]
            # Keep is_superuser in sync with role=admin only when an admin flips it.
            if data["role"] == "admin" and actor.is_superuser:
                user.is_superuser = True
            elif data["role"] != "admin" and actor.is_superuser:
                user.is_superuser = False

        if "full_name" in data and data["full_name"] is not None:
            user.full_name = data["full_name"]

        if "email" in data and data["email"] is not None:
            user.email = str(data["email"])

        if "is_active" in data and data["is_active"] is not None:
            user.is_active = bool(data["is_active"])
            user.status = "active" if user.is_active else "inactive"

        # If role transitioned into a wallet-eligible role, ensure a wallet exists.
        # Existing wallet (from a previous role) is preserved — the wallet follows
        # the user across role changes by virtue of being keyed to user_id.
        if user.role in WALLET_ROLES:
            from app.services.wallet_service import WalletService
            WalletService.ensure_wallet_for_user(db, user.id)

        db.commit()
        db.refresh(user)
        return UserService._user_to_response(user)

    @staticmethod
    def delete_user(db: Session, user_id: int) -> None:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise LookupError("User not found")
        db.delete(user)
        db.commit()

    # ── Helpers ──────────────────────────────────────────────────────────

    @staticmethod
    def _user_to_response(user: User) -> UserResponse:
        shop_name: Optional[str] = None
        if user.shop_id:
            shop = getattr(user, "shop", None)
            shop_name = shop.name if shop else None
        return UserResponse(
            id=user.id,
            username=user.username,
            email=user.email,
            full_name=user.full_name,
            role=user.role,
            is_active=bool(user.is_active),
            is_superuser=bool(user.is_superuser),
            shop_id=user.shop_id,
            shop_name=shop_name,
            external_id=user.external_id,
            family_code=user.family_code,
            status=user.status,
            created_at=user.created_at,
        )
