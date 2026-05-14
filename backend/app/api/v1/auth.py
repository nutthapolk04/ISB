"""
Auth API Routes
POST /api/v1/auth/login   — obtain tokens
GET  /api/v1/auth/me      — current user info
POST /api/v1/auth/logout  — client-side token invalidation hint
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user, require_role
from app.models.user import User, Role
from app.schemas.auth import LoginRequest, TokenResponse, MeResponse, UserResponse, RoleResponse, CreateUserRequest, MockSSORequest
from app.services.auth_service import AuthService
from app.core.security import get_password_hash, verify_password

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    """
    Authenticate with username + password, return JWT tokens.
    """
    service = AuthService(db)
    user = service.authenticate_user(payload.username, payload.password)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is inactive",
        )

    tokens = service.create_tokens(user)
    return TokenResponse(**tokens)


@router.post("/sso/mock", response_model=TokenResponse)
def mock_sso(payload: MockSSORequest, db: Session = Depends(get_db)):
    """
    Mock SSO endpoint — simulates Azure/Google OAuth callback.
    Takes email + full_name, auto-creates parent user if not exists.
    DEMO ONLY: real implementation would verify OIDC token from provider.
    """
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Valid email required")

    # Look up by email
    user = db.query(User).filter(User.email == email).first()
    if not user:
        # Auto-create parent user. Username = email local part + random suffix.
        username_base = email.split("@")[0].replace(".", "_")
        username = username_base
        suffix = 1
        while db.query(User).filter(User.username == username).first():
            username = f"{username_base}{suffix}"
            suffix += 1
        user = User(
            username=username,
            email=email,
            hashed_password=get_password_hash(f"sso-{email}"),  # not used for login
            full_name=payload.full_name or email.split("@")[0].replace(".", " ").title(),
            is_active=True,
            is_superuser=False,
            role="parent",
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is inactive")

    service = AuthService(db)
    tokens = service.create_tokens(user)
    return TokenResponse(**tokens)


@router.get("/me", response_model=MeResponse)
def me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Return the current authenticated user's profile and permissions.
    """
    service = AuthService(db)
    permissions = service.get_user_permissions(current_user)

    # Derive shop_module: explicit column wins, then fall back to shop.module
    shop_module = current_user.shop_module
    if not shop_module and current_user.shop:
        shop_module = getattr(current_user.shop, "module", None)

    user_response = UserResponse(
        id=current_user.id,
        username=current_user.username,
        email=current_user.email,
        full_name=current_user.full_name,
        is_active=current_user.is_active,
        is_superuser=current_user.is_superuser,
        role=current_user.role,
        roles=[
            RoleResponse(id=r.id, name=r.name, description=r.description)
            for r in current_user.roles
        ],
        shop_id=current_user.shop_id,
        shop_module=shop_module,
    )

    return MeResponse(user=user_response, permissions=permissions)


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register_user(
    payload: CreateUserRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new user account. Requires authenticated user (admin)."""
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Admin only")
    existing = db.query(User).filter(User.username == payload.username).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Username '{payload.username}' already exists")
    email = payload.email or f"{payload.username}@isb-coop.local"
    user = User(
        username=payload.username,
        email=email,
        hashed_password=get_password_hash(payload.password),
        full_name=payload.full_name,
        is_active=True,
        is_superuser=payload.is_superuser,
        role=payload.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        full_name=user.full_name,
        is_active=user.is_active,
        is_superuser=user.is_superuser,
        roles=[],
    )


@router.get("/users", response_model=list[UserResponse])
def list_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all users."""
    try:
        users = db.query(User).order_by(User.id).all()
        return [
            UserResponse(
                id=u.id, username=u.username, email=u.email,
                full_name=u.full_name, is_active=u.is_active,
                is_superuser=u.is_superuser, roles=[],
            )
            for u in users
        ]
    except Exception:
        logger.exception("list_users failed")
        raise


# ── Multi-role management (Staff-Parent hybrid) ─────────────────────────────

class AssignRoleRequest(BaseModel):
    role_name: str


@router.get("/users/{user_id}/roles", response_model=list[RoleResponse])
def list_user_roles(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """List all secondary roles assigned to a user (on top of user.role)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return [RoleResponse(id=r.id, name=r.name, description=r.description) for r in user.roles]


@router.post("/users/{user_id}/roles", response_model=list[RoleResponse], status_code=status.HTTP_201_CREATED)
def assign_role_to_user(
    user_id: int,
    payload: AssignRoleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Assign an additional role to a user (multi-role support for Staff-Parent hybrid)."""
    name = (payload.role_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="role_name is required")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    role = db.query(Role).filter(Role.name == name).first()
    if not role:
        role = Role(name=name, description=f"Auto-created for {name}", is_active=True)
        db.add(role)
        db.flush()

    if role not in user.roles:
        user.roles.append(role)
        db.commit()

    db.refresh(user)
    return [RoleResponse(id=r.id, name=r.name, description=r.description) for r in user.roles]


@router.delete("/users/{user_id}/roles/{role_name}", response_model=list[RoleResponse])
def remove_role_from_user(
    user_id: int,
    role_name: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Remove a role from a user."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.roles = [r for r in user.roles if r.name != role_name]
    db.commit()
    db.refresh(user)
    return [RoleResponse(id=r.id, name=r.name, description=r.description) for r in user.roles]


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout():
    """
    Logout hint — token invalidation is handled client-side.
    For production, implement a token blacklist or use short-lived tokens.
    """
    return


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Self-service password change. Verifies current password first."""
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
    if payload.new_password == payload.current_password:
        raise HTTPException(status_code=400, detail="New password must differ from current password")
    current_user.hashed_password = get_password_hash(payload.new_password)
    db.commit()
    return
