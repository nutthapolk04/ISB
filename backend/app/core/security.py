"""
Security and Authentication Utilities
"""
import secrets
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# HTTP Bearer security scheme
security = HTTPBearer()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against a hashed password"""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Hash a password"""
    return pwd_context.hash(password)


# Password policy — must match frontend/src/lib/passwordRules.ts so the
# checklist that the user sees while typing matches what the server accepts.
_PASSWORD_RULES = (
    ("at least 8 characters", lambda pw: len(pw) >= 8),
    ("an upper-case letter", lambda pw: any(c.isupper() for c in pw)),
    ("a lower-case letter", lambda pw: any(c.islower() for c in pw)),
    ("a number", lambda pw: any(c.isdigit() for c in pw)),
    ("a special character", lambda pw: any(not c.isalnum() for c in pw)),
)


def validate_password_policy(password: str) -> None:
    """Raise HTTPException(400) when `password` doesn't satisfy the policy.

    Call before hashing in every create/change-password code path. Frontend
    enforces the same rules in the UI, but never trust the client — a manager
    hand-rolling a curl request must hit the same wall.
    """
    from fastapi import HTTPException

    failed = [label for label, check in _PASSWORD_RULES if not check(password)]
    if failed:
        raise HTTPException(
            status_code=400,
            detail="Password must contain " + ", ".join(failed),
        )


def generate_session_token() -> str:
    """Generate a cryptographically secure session token (64 hex chars)."""
    return secrets.token_hex(32)


def create_access_token(
    data: Dict[str, Any],
    expires_delta: Optional[timedelta] = None,
    session_token: Optional[str] = None,
) -> str:
    """
    Create a JWT access token

    Args:
        data: Dictionary containing claims to encode
        expires_delta: Optional expiration time delta
        session_token: Optional session token to embed as 'sid' claim

    Returns:
        Encoded JWT token string
    """
    to_encode = data.copy()

    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode.update({"exp": expire, "type": "access"})
    if session_token is not None:
        to_encode["sid"] = session_token
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

    return encoded_jwt


def create_refresh_token(data: Dict[str, Any]) -> str:
    """
    Create a JWT refresh token

    Args:
        data: Dictionary containing claims to encode

    Returns:
        Encoded JWT refresh token string
    """
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})

    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def decode_token(token: str) -> Dict[str, Any]:
    """
    Decode and verify a JWT token

    Args:
        token: JWT token string

    Returns:
        Decoded token payload

    Raises:
        HTTPException: If token is invalid or expired
    """
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
):
    """
    Get the current authenticated user from JWT token

    Dependencies:
        credentials: HTTP Bearer token from request header
        db: Database session

    Returns:
        Current user object

    Raises:
        HTTPException: If authentication fails
    """
    token = credentials.credentials
    payload = decode_token(token)

    user_id: str = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # TODO: Fetch user from database using user_id
    # This will be implemented once User model is created
    # For now, return a mock user dict
    return {"id": user_id, "email": payload.get("email")}


def check_permission(required_role: str):
    """
    Decorator to check if user has required role

    Args:
        required_role: Role name required for access

    Returns:
        Dependency function for FastAPI
    """
    async def permission_checker(current_user = Depends(get_current_user)):
        # TODO: Implement role checking once User-Role relationship is established
        # For now, allow all authenticated users
        return current_user

    return permission_checker
