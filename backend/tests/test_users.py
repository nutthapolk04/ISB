"""
Tests for the shop-scoped user management API (`/api/v1/users`).

Covers the permission matrix for admin / manager / cashier across list,
create, update and delete.
"""
from __future__ import annotations


# ── LIST ─────────────────────────────────────────────────────────────────────


def test_admin_list_returns_all_users(client, seeded):
    res = client.get("/api/v1/users/", headers=seeded["admin_headers"])
    assert res.status_code == 200
    body = res.json()
    assert body["total"] >= 5
    usernames = {item["username"] for item in body["items"]}
    assert {"admin", "coop_mgr", "canteen_mgr", "coop_cashier", "canteen_cashier"} <= usernames


def test_manager_list_scoped_to_own_shop(client, seeded):
    res = client.get("/api/v1/users/", headers=seeded["coop_mgr_headers"])
    assert res.status_code == 200
    body = res.json()
    # Should only return users in shop_id="coop"
    for item in body["items"]:
        assert item["shop_id"] == "coop"
    usernames = {item["username"] for item in body["items"]}
    assert "coop_cashier" in usernames
    assert "canteen_cashier" not in usernames
    assert "admin" not in usernames  # admin has no shop_id


def test_manager_cannot_see_unassigned_for_other_shop(client, seeded):
    # Manager passes shop_id=canteen but is forced to their own (coop).
    res = client.get(
        "/api/v1/users/?shop_id=canteen&unassigned=true",
        headers=seeded["coop_mgr_headers"],
    )
    assert res.status_code == 200
    body = res.json()
    for item in body["items"]:
        assert item["shop_id"] == "coop"


def test_cashier_list_forbidden(client, seeded):
    res = client.get("/api/v1/users/", headers=seeded["coop_cashier_headers"])
    assert res.status_code == 403


def test_list_without_token_is_unauthorized(client, seeded):
    res = client.get("/api/v1/users/")
    # HTTPBearer returns 403 when no header is sent.
    assert res.status_code in (401, 403)


# ── CREATE ───────────────────────────────────────────────────────────────────


def test_admin_can_create_user_in_any_shop(client, seeded):
    payload = {
        "username": "new_cashier",
        "password": "secret123",
        "full_name": "New Cashier",
        "role": "cashier",
        "shop_id": "canteen",
        "email": "new_cashier@isb-coop.local",
    }
    res = client.post(
        "/api/v1/users/", json=payload, headers=seeded["admin_headers"]
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["username"] == "new_cashier"
    assert body["shop_id"] == "canteen"
    assert body["external_id"] is None


def test_manager_create_in_own_shop_success(client, seeded):
    payload = {
        "username": "coop_new_cashier",
        "password": "secret123",
        "full_name": "Coop New",
        "role": "cashier",
        "shop_id": "coop",
    }
    res = client.post(
        "/api/v1/users/", json=payload, headers=seeded["coop_mgr_headers"]
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["shop_id"] == "coop"
    assert body["role"] == "cashier"
    assert body["external_id"] is None  # managers can't overwrite via PS sync


def test_manager_create_in_other_shop_forbidden(client, seeded):
    payload = {
        "username": "cross_shop",
        "password": "secret123",
        "full_name": "Cross Shop",
        "role": "cashier",
        "shop_id": "canteen",
    }
    res = client.post(
        "/api/v1/users/", json=payload, headers=seeded["coop_mgr_headers"]
    )
    assert res.status_code == 403


def test_manager_cannot_create_manager(client, seeded):
    payload = {
        "username": "would_be_mgr",
        "password": "secret123",
        "full_name": "Would-Be Manager",
        "role": "manager",
        "shop_id": "coop",
    }
    res = client.post(
        "/api/v1/users/", json=payload, headers=seeded["coop_mgr_headers"]
    )
    assert res.status_code == 403


def test_cashier_cannot_create(client, seeded):
    payload = {
        "username": "nope",
        "password": "secret123",
        "full_name": "Nope",
        "role": "cashier",
        "shop_id": "coop",
    }
    res = client.post(
        "/api/v1/users/", json=payload, headers=seeded["coop_cashier_headers"]
    )
    assert res.status_code == 403


# ── UPDATE ───────────────────────────────────────────────────────────────────


def test_admin_can_reassign_shop(client, seeded):
    cashier_id = seeded["coop_cashier"].id
    res = client.patch(
        f"/api/v1/users/{cashier_id}",
        json={"shop_id": "canteen"},
        headers=seeded["admin_headers"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["shop_id"] == "canteen"


def test_manager_cannot_patch_cross_shop_user(client, seeded):
    canteen_cashier_id = seeded["canteen_cashier"].id
    res = client.patch(
        f"/api/v1/users/{canteen_cashier_id}",
        json={"full_name": "Hacker"},
        headers=seeded["coop_mgr_headers"],
    )
    assert res.status_code == 403


def test_manager_can_patch_own_shop_user(client, seeded):
    coop_cashier_id = seeded["coop_cashier"].id
    res = client.patch(
        f"/api/v1/users/{coop_cashier_id}",
        json={"full_name": "Renamed Cashier"},
        headers=seeded["coop_mgr_headers"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["full_name"] == "Renamed Cashier"


def test_manager_cannot_promote_to_admin(client, seeded):
    coop_cashier_id = seeded["coop_cashier"].id
    res = client.patch(
        f"/api/v1/users/{coop_cashier_id}",
        json={"role": "admin"},
        headers=seeded["coop_mgr_headers"],
    )
    assert res.status_code == 403


# ── DELETE ───────────────────────────────────────────────────────────────────


def test_admin_can_delete_user(client, seeded):
    target_id = seeded["coop_cashier"].id
    res = client.delete(
        f"/api/v1/users/{target_id}", headers=seeded["admin_headers"]
    )
    assert res.status_code == 204
    # Verify gone.
    res2 = client.get(
        f"/api/v1/users/{target_id}", headers=seeded["admin_headers"]
    )
    assert res2.status_code == 404


def test_manager_cannot_delete(client, seeded):
    target_id = seeded["coop_cashier"].id
    res = client.delete(
        f"/api/v1/users/{target_id}", headers=seeded["coop_mgr_headers"]
    )
    assert res.status_code == 403


def test_admin_cannot_delete_self(client, seeded):
    res = client.delete(
        f"/api/v1/users/{seeded['admin'].id}", headers=seeded["admin_headers"]
    )
    assert res.status_code == 400
