"""
API Dependencies
Shared dependencies for API routes
"""
from typing import Generator, Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_token
from app.models.user import User

security = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """Get current authenticated user from JWT token."""
    token = credentials.credentials
    payload = decode_token(token)

    user_id: str = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.query(User).filter(User.id == int(user_id)).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user"
        )

    return user


def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """Get current active user."""
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user"
        )
    return current_user


def get_current_superuser(
    current_user: User = Depends(get_current_user),
) -> User:
    """Get current superuser (admin)."""
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough privileges"
        )
    return current_user


def _effective_roles(user: User) -> set[str]:
    """Collect all roles this user holds — from legacy single `role` and many-to-many `roles`."""
    roles: set[str] = set()
    if user.is_superuser:
        roles.add("admin")
    if user.role:
        roles.add(user.role)
    # Many-to-many roles (supports Staff-Parent hybrid etc.)
    try:
        for r in (user.roles or []):
            name = getattr(r, "name", None)
            if name:
                roles.add(name)
    except Exception:
        pass
    if not roles:
        roles.add("cashier")
    return roles


def require_role(*allowed_roles: str):
    """
    Dependency factory: restrict endpoint to specific roles.

    Usage:
        @router.post("/void/{id}")
        def void_receipt(current_user: User = Depends(require_role("admin", "manager"))):
            ...

    Roles: "admin", "manager", "cashier", "parent"
    - is_superuser=True always treated as "admin".
    - Supports users with multiple roles via User.roles many-to-many (Staff-Parent hybrid).
    """
    allowed = set(allowed_roles)

    def role_checker(current_user: User = Depends(get_current_user)) -> User:
        user_roles = _effective_roles(current_user)
        if not (user_roles & allowed):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Roles {sorted(user_roles)} not authorized. Required any of: {sorted(allowed)}",
            )
        return current_user
    return role_checker


def user_can_access_shop(user: User, shop_id: Optional[str]) -> bool:
    """
    Return True if the user is allowed to read/write data for `shop_id`.

    Rules:
    - admin / superuser: access to ALL shops
    - users with `shop_id = None` (unscoped): treated as all-shops (e.g., multi-shop manager)
    - managers / cashiers / canteen_owner: only their own `users.shop_id`
    - other roles (parent, student, teacher, staff, visitor): no shop-scoped write access,
      but they may still invoke public endpoints (POS checkout-by-card is scoped here too).
    """
    if user.is_superuser:
        return True
    roles = _effective_roles(user)
    if "admin" in roles:
        return True
    user_shop = getattr(user, "shop_id", None)
    # Unscoped manager (null shop_id) = can see all (e.g., regional manager)
    if user_shop is None and roles & {"manager"}:
        return True
    # Target-less operations (e.g., listing across all shops) are gated by role alone
    if shop_id is None:
        return True
    return user_shop == shop_id


def require_shop_access(
    shop_id: str,
    current_user: User = Depends(get_current_user),
) -> User:
    """
    Dependency: enforce that `current_user` can access the `shop_id` path param.

    Reads `shop_id` from the route (FastAPI resolves path params automatically).
    Admin / superuser / unscoped manager see all shops; others only their own.

    Usage:
        @router.get("/{shop_id}/products")
        def list_products(
            shop_id: str,
            current_user: User = Depends(require_shop_access),
        ):
            ...
    """
    if not user_can_access_shop(current_user, shop_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"User {current_user.username} (shop={getattr(current_user, 'shop_id', None)}) "
                f"is not authorized to access shop '{shop_id}'"
            ),
        )
    return current_user


def check_permission(permission_name: str):
    """
    Check if current user has specific permission.
    Now delegates to role-based check as a simple implementation.
    """
    # Map permission names to minimum required roles
    PERMISSION_ROLES = {
        "create_product": ("admin", "manager"),
        "update_product": ("admin", "manager"),
        "delete_product": ("admin", "manager"),
    }
    allowed = PERMISSION_ROLES.get(permission_name, ("admin", "manager", "cashier"))
    return require_role(*allowed)
