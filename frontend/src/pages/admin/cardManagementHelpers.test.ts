/**
 * Card Management merges four endpoints into one table with no de-duplication,
 * and each row's `kind` decides which API its buttons call. These tests pin the
 * two rules that keeps safe.
 *
 * The regression they exist for (2026-08): once ISB "other" cardholders
 * shipped, `?kind=other` started returning users with role='other' as well as
 * customers — deliberately, so the Cardholders directory could list them —
 * while `/users-admin/` had always returned every user with no role filter.
 * One synced visitor card therefore rendered TWICE, and the phantom row wore
 * `kind: "customer"` while carrying a users id. That row's buttons pointed at
 * `POST /customers/:id/freeze`, `PATCH /customers/:id/card` and
 * `/admin/customer/:id` — so "change UID" on it would have rebound whichever
 * STUDENT happened to hold that id. It also read "Student", because the role
 * badge fell back to that literal whenever `customerType` was absent.
 */
import { describe, expect, it } from "vitest";
import {
    buildBoundCards,
    customerBadgeLabel,
    otherCustomerRowsFrom,
    type CardholderApiItem,
    type DepartmentRow,
    type StudentRow,
    type UserRow,
} from "./cardManagementHelpers";

// ── otherCustomerRowsFrom ─────────────────────────────────────────────────

describe("otherCustomerRowsFrom", () => {
    const customer: CardholderApiItem = {
        entity_type: "customer", entity_id: 41, name: "Walk-in Visitor",
        identifier: "V-0041", card_uid: "AAAA1111", is_active: true,
    };
    // What ?kind=other now also returns: a users row with role='other'.
    const userItem: CardholderApiItem = {
        entity_type: "user", entity_id: 41, name: "RM Pallent",
        identifier: "other-2028931", card_uid: "068503AF", is_active: true,
    };

    it("keeps customers", () => {
        expect(otherCustomerRowsFrom([customer])).toEqual([{
            id: 41, name: "Walk-in Visitor", customer_code: "V-0041",
            customer_kind: "other", card_uid: "AAAA1111",
            card_frozen: false, is_active: true,
        }]);
    });

    it("drops users — /users-admin/ already returns them", () => {
        expect(otherCustomerRowsFrom([userItem])).toEqual([]);
    });

    it("keeps only the customer when both share an id", () => {
        // The collision that made this dangerous: entity_id 41 is a users id on
        // one item and a customers id on the other. Mapping both would produce
        // two `kind: "customer"` rows pointing at /customers/41.
        const rows = otherCustomerRowsFrom([customer, userItem]);
        expect(rows).toHaveLength(1);
        expect(rows[0].card_uid).toBe("AAAA1111");
    });

    it("drops anything whose entity_type is missing or unknown", () => {
        // Fail closed: an unlabelled row cannot be proven to be a customer, and
        // guessing wrong points destructive actions at the wrong table.
        expect(otherCustomerRowsFrom([
            { entity_id: 1, name: "no type", card_uid: "X" } as CardholderApiItem,
            { entity_type: "department", entity_id: 2, name: "dept", card_uid: "Y" },
        ])).toEqual([]);
    });

    it("tolerates null/undefined and a missing identifier", () => {
        expect(otherCustomerRowsFrom(null)).toEqual([]);
        expect(otherCustomerRowsFrom(undefined)).toEqual([]);
        expect(otherCustomerRowsFrom([])).toEqual([]);
        const [row] = otherCustomerRowsFrom([{ entity_type: "customer", entity_id: 7, name: "n" }]);
        expect(row.customer_code).toBe("");
        expect(row.card_uid).toBeNull();
        expect(row.is_active).toBe(true);
    });

    it("normalises a blank card_uid to null so buildBoundCards drops it", () => {
        const [row] = otherCustomerRowsFrom([
            { entity_type: "customer", entity_id: 8, name: "n", card_uid: "" },
        ]);
        expect(row.card_uid).toBeNull();
        expect(buildBoundCards({ users: [], students: [], departments: [], otherCustomers: [row] })).toEqual([]);
    });
});

// ── buildBoundCards ───────────────────────────────────────────────────────

const visitorUser: UserRow = {
    id: 6106, username: "other-2028931", full_name: "RM Pallent",
    email: "other-2028931@others.isb.ac.th", role: "other", status: "active",
    is_active: true, card_uid: "068503AF", external_id: "2028931", family_code: "2028931",
};

describe("buildBoundCards", () => {
    it("renders a synced 'other' user exactly once, as a user", () => {
        const cards = buildBoundCards({
            users: [visitorUser],
            students: [],
            departments: [],
            // Correctly filtered by otherCustomerRowsFrom, so nothing here.
            otherCustomers: [],
        });
        expect(cards).toHaveLength(1);
        expect(cards[0].kind).toBe("user");
        expect(cards[0].role).toBe("other");
        // Actions must target /users-admin/:id, which `kind: "user"` selects.
        expect(cards[0].id).toBe(6106);
        expect(cards[0].identifier).toBe("other-2028931@others.isb.ac.th");
        expect(cards[0].familyCode).toBe("2028931");
        expect(cards[0].externalId).toBe("2028931");
    });

    it("would double-count if a users row leaked into the other-customers source", () => {
        // Guards the fix from the other direction: this is the broken input
        // that otherCustomerRowsFrom now makes unreachable. If someone
        // reintroduces it, the assertion below documents exactly what breaks.
        const leaked = buildBoundCards({
            users: [visitorUser],
            students: [],
            departments: [],
            otherCustomers: [{
                id: 6106, name: "RM Pallent", customer_code: "other-2028931",
                customer_kind: "other", card_uid: "068503AF", card_frozen: false, is_active: true,
            }],
        });
        expect(leaked).toHaveLength(2);
        // ...and the phantom would send freeze/change-UID to /customers/6106.
        expect(leaked.some((c) => c.kind === "customer" && c.id === 6106)).toBe(true);
    });

    it("stamps a kind per source so actions hit the right API", () => {
        const student: StudentRow = {
            id: 141, name: "Adira DAWAR", customer_code: "C-141", student_code: "23026",
            card_uid: "BBBB2222", school_type: "HS", family_code: "9001", external_id: "23026",
        };
        const dept: DepartmentRow = {
            id: 2, department_code: "OPS", department_name: "Operations", card_uid: "CCCC3333", is_active: true,
        };
        const cards = buildBoundCards({
            users: [visitorUser],
            students: [student],
            departments: [dept],
            otherCustomers: [{
                id: 41, name: "Walk-in", customer_code: "V-0041", customer_kind: "other",
                card_uid: "AAAA1111", card_frozen: false, is_active: true,
            }],
        });
        expect(cards.map((c) => [c.uid, c.kind, c.role])).toEqual([
            ["068503AF", "user", "other"],
            ["AAAA1111", "customer", "other"],
            ["BBBB2222", "customer", "student"],
            ["CCCC3333", "department", "department"],
        ]);
    });

    it("drops cardholders with no card, since this screen is the UID map", () => {
        expect(buildBoundCards({
            users: [{ ...visitorUser, card_uid: null }],
            students: [{ id: 1, name: "n", customer_code: "c" }],
            departments: [{ id: 1, department_code: "D", department_name: "d" }],
            otherCustomers: [],
        })).toEqual([]);
    });

    it("derives frozen from active per source", () => {
        const [u] = buildBoundCards({
            users: [{ ...visitorUser, is_active: false, status: "inactive" }],
            students: [], departments: [], otherCustomers: [],
        });
        expect(u.isActive).toBe(false);
        expect(u.isFrozen).toBe(true);

        // A user row with no is_active falls back to status.
        const [u2] = buildBoundCards({
            users: [{ ...visitorUser, is_active: undefined, status: "inactive" }],
            students: [], departments: [], otherCustomers: [],
        });
        expect(u2.isFrozen).toBe(true);

        // Customers carry a real card_frozen flag, independent of is_active.
        const [c] = buildBoundCards({
            users: [], departments: [], otherCustomers: [],
            students: [{ id: 1, name: "n", customer_code: "c", card_uid: "Z", card_frozen: true, is_active: true }],
        });
        expect(c.isActive).toBe(true);
        expect(c.isFrozen).toBe(true);
    });
});

// ── customerBadgeLabel ────────────────────────────────────────────────────

describe("customerBadgeLabel", () => {
    it("prefers customerType — school_type for a student", () => {
        expect(customerBadgeLabel("HS", "student")).toEqual({ source: "customerType", value: "HS" });
    });

    it("labels a visitor customer by its role, not 'Student'", () => {
        // The pre-existing bug: customer_kind='other' rows carry no
        // customerType, so `customerType || "Student"` mislabelled every one.
        expect(customerBadgeLabel(null, "other")).toEqual({ source: "role", value: "other" });
        expect(customerBadgeLabel(undefined, "other")).toEqual({ source: "role", value: "other" });
        expect(customerBadgeLabel("", "other")).toEqual({ source: "role", value: "other" });
    });

    it("still says Student when neither is known", () => {
        // Every customer source except "other" really is a student, so this
        // stays the last resort rather than rendering an empty badge.
        expect(customerBadgeLabel(null, null)).toEqual({ source: "studentFallback" });
        expect(customerBadgeLabel(undefined, "")).toEqual({ source: "studentFallback" });
    });
});
