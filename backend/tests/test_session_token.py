"""
Single-session enforcement tests (Feature 9 — deps.py).

Covers the three access paths:
  1. JWT with correct sid  → 200 OK
  2. JWT with wrong sid    → 401 Expired
  3. Legacy JWT (no sid)  + user HAS session_token in DB → 401 Expired
  4. Legacy JWT (no sid)  + user has NO session_token    → 200 OK (pre-feature pass-through)
  5. Login rotates session_token (second login invalidates first)
"""
from __future__ import annotations

import pytest
from app.core.security import create_access_token, generate_session_token


# ── Helpers ──────────────────────────────────────────────────────────────────

def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _token(user, sid: str | None = None) -> str:
    return create_access_token(
        {"sub": str(user.id), "email": user.email},
        session_token=sid,
    )


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_correct_sid_passes(client, seeded):
    """JWT carrying the matching sid should be accepted."""
    user = seeded["coop_cashier"]
    sid = generate_session_token()
    user.session_token = sid
    # commit via the same db_session the fixture uses
    client.app.dependency_overrides  # ensure overrides are active
    # use /api/v1/auth/me as a lightweight auth-gated endpoint
    tok = _token(user, sid=sid)
    res = client.get("/api/v1/auth/me", headers=_auth(tok))
    assert res.status_code == 200, res.text


def test_wrong_sid_blocked(client, seeded):
    """JWT carrying a stale/wrong sid is rejected with 401."""
    user = seeded["coop_cashier"]
    user.session_token = generate_session_token()
    wrong_sid = generate_session_token()  # different token
    tok = _token(user, sid=wrong_sid)
    res = client.get("/api/v1/auth/me", headers=_auth(tok))
    assert res.status_code == 401
    assert "expired" in res.json().get("detail", "").lower()


def test_legacy_jwt_blocked_when_db_has_session_token(client, seeded):
    """Legacy JWT (no sid) must be rejected when the DB already stores a session_token.

    This prevents old tokens from bypassing single-session enforcement after
    Feature 9 was deployed.
    """
    user = seeded["coop_cashier"]
    user.session_token = generate_session_token()
    legacy_tok = _token(user, sid=None)  # no sid claim
    res = client.get("/api/v1/auth/me", headers=_auth(legacy_tok))
    assert res.status_code == 401
    assert "expired" in res.json().get("detail", "").lower()


def test_legacy_jwt_allowed_when_no_session_token(client, seeded):
    """Legacy JWT (no sid) is allowed when the user has no session_token yet.

    This preserves backward-compat for users whose accounts pre-date the feature.
    """
    user = seeded["coop_cashier"]
    user.session_token = None  # no session token assigned yet
    legacy_tok = _token(user, sid=None)
    res = client.get("/api/v1/auth/me", headers=_auth(legacy_tok))
    assert res.status_code == 200, res.text


def test_login_rotates_session_token(client, seeded):
    """A second login should generate a new session_token, invalidating prior JWTs."""
    payload = {"username": "coop_cashier", "password": "cashier123"}

    # First login
    r1 = client.post("/api/v1/auth/login", json=payload)
    assert r1.status_code == 200, r1.text
    tok1 = r1.json()["access_token"]

    # Second login
    r2 = client.post("/api/v1/auth/login", json=payload)
    assert r2.status_code == 200, r2.text
    tok2 = r2.json()["access_token"]

    # First token must now be invalid (session_token in DB was overwritten by r2)
    res_old = client.get("/api/v1/auth/me", headers=_auth(tok1))
    assert res_old.status_code == 401, "Old token should have been invalidated"

    # Second token must still work
    res_new = client.get("/api/v1/auth/me", headers=_auth(tok2))
    assert res_new.status_code == 200, res_new.text
