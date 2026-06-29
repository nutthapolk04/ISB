"""
Auth Service — authentication and user lookup logic
"""
from typing import Optional
from datetime import timedelta
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.user import User
from app.core.security import verify_password, create_access_token, create_refresh_token, generate_session_token
from app.core.config import settings


class AuthService:
    def __init__(self, db: Session):
        self.db = db

    def authenticate_user(self, username: str, password: str) -> Optional[User]:
        """
        Verify credentials and return the user if valid.
        Returns None if username not found or password is wrong.
        """
        user = self.db.query(User).filter(
            func.lower(User.username) == username.lower()
        ).first()
        if not user:
            return None
        if not verify_password(password, user.hashed_password):
            return None
        return user

    def create_tokens(self, user: User) -> dict:
        """Create access + refresh tokens for the given user.

        Rotates the session_token on every call so any previously issued
        access token becomes invalid (single-session enforcement).
        """
        sid = generate_session_token()
        user.session_token = sid
        self.db.commit()

        role_names = [role.name for role in user.roles]
        payload = {
            "sub": str(user.id),
            "username": user.username,
            "email": user.email,
            "roles": role_names,
            "is_superuser": user.is_superuser,
        }
        access_token = create_access_token(
            data=payload,
            expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
            session_token=sid,
        )
        refresh_token = create_refresh_token(data={"sub": str(user.id)})
        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
        }

    def get_user_permissions(self, user: User) -> list[str]:
        """Collect all permission names from all of the user's roles."""
        permissions: set[str] = set()
        for role in user.roles:
            for perm in role.permissions:
                permissions.add(perm.name)
        return sorted(permissions)
