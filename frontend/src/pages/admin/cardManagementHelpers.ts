/**
 * Pure pieces of Card Management, extracted so the two money-adjacent
 * decisions it makes are unit-testable without mounting the page.
 *
 * Card Management is the only screen that stitches FOUR independent
 * endpoints into one table:
 *
 *   /users-admin/                       → every users row, no role filter
 *   /users-admin/students               → customers with customer_kind='student'
 *   /departments/?active_only=false     → departments
 *   /admin/cardholders?kind=other       → the "other" bucket
 *
 * Nothing de-dupes the result, and nothing can: `kind` is what the row's
 * action buttons dispatch on. A `kind: "customer"` row sends freeze to
 * `POST /customers/:id/freeze`, change-UID to `PATCH /customers/:id/card`
 * and its detail link to `/admin/customer/:id` — all with whatever `id` the
 * row carries. So a users row that leaks in wearing `kind: "customer"` does
 * not merely look wrong: its buttons act on the CUSTOMER holding that id.
 *
 * That is exactly what happened once ISB "other" cardholders shipped
 * (2026-08): `?kind=other` began returning users with role='other' too — a
 * deliberate change so the Cardholders directory could list them — while
 * `/users-admin/` had always returned them already. One synced visitor card
 * rendered twice, and the phantom row's "change UID" would have rebound an
 * unrelated student's card. Keeping the four sources disjoint is therefore a
 * correctness requirement, not tidiness.
 */

// ── Source row shapes (only the fields these helpers read) ─────────────────

export interface CardholderApiItem {
    entity_type?: "user" | "customer" | "department" | string | null;
    entity_id: number;
    name: string;
    identifier?: string | null;
    card_uid?: string | null;
    is_active?: boolean | null;
}

export interface OtherCustomerRow {
    id: number;
    name: string;
    customer_code: string;
    customer_kind: string;
    card_uid?: string | null;
    card_frozen?: boolean;
    is_active?: boolean;
}

/**
 * Keep only the customers from an `?kind=other` response.
 *
 * The users in that bucket are already covered by `/users-admin/`, and they
 * must NOT be re-mapped here: this mapping produces `kind: "customer"` rows,
 * which would point every action at `/customers/:id` using a users id.
 */
export function otherCustomerRowsFrom(items: CardholderApiItem[] | null | undefined): OtherCustomerRow[] {
    return (items ?? [])
        .filter((c) => c.entity_type === "customer")
        .map((c) => ({
            id: c.entity_id,
            name: c.name,
            customer_code: c.identifier ?? "",
            customer_kind: "other",
            card_uid: c.card_uid || null,
            // The cardholders endpoint doesn't report freeze state; assume
            // unfrozen rather than rendering a card as frozen on no evidence.
            card_frozen: false,
            is_active: c.is_active ?? true,
        }));
}

// ── The merge ─────────────────────────────────────────────────────────────

export interface UserRow {
    id: number;
    username: string;
    full_name: string;
    email?: string | null;
    role: string;
    status?: string | null;
    is_active?: boolean;
    customer_type?: string | null;
    card_uid?: string | null;
    external_id?: string | null;
    family_code?: string | null;
    photo_url?: string | null;
    staff_type?: string | null;
    ps_department?: string | null;
}

export interface StudentRow {
    id: number;
    name: string;
    student_code?: string | null;
    customer_code: string;
    grade?: string | null;
    family_code?: string | null;
    external_id?: string | null;
    school_type?: string | null;
    card_uid?: string | null;
    card_frozen?: boolean;
    is_active?: boolean;
    photo_url?: string | null;
}

export interface DepartmentRow {
    id: number;
    department_code: string;
    department_name: string;
    card_uid?: string | null;
    is_active?: boolean;
}

export interface BoundCard {
    kind: "user" | "customer" | "department";
    id: number;
    uid: string;
    name: string;
    role: string;
    isFrozen: boolean;
    isActive: boolean;
    customerType?: string | null;
    identifier?: string | null;
    familyCode?: string | null;
    externalId?: string | null;
    photoUrl?: string | null;
    staffType?: string | null;
    psDepartment?: string | null;
}

/**
 * Flatten the four sources into one table, one row per bound card.
 *
 * Each source owns a disjoint set of entities and stamps its own `kind`, which
 * is what the row's actions dispatch on — see this module's header. Cards with
 * no uid are dropped: this screen is the UID map, so a cardholder without one
 * has nothing to show.
 */
export function buildBoundCards(src: {
    users: UserRow[];
    students: StudentRow[];
    departments: DepartmentRow[];
    otherCustomers: OtherCustomerRow[];
}): BoundCard[] {
    const list: BoundCard[] = [];
    for (const u of src.users) {
        if (!u.card_uid) continue;
        const active = u.is_active ?? (u.status === "active");
        list.push({
            kind: "user",
            id: u.id,
            uid: u.card_uid,
            name: u.full_name || u.username,
            role: u.role,
            isActive: active,
            isFrozen: !active,
            customerType: u.customer_type,
            identifier: u.email || u.username,
            familyCode: u.family_code,
            externalId: u.external_id,
            photoUrl: u.photo_url,
            staffType: u.staff_type,
            psDepartment: u.ps_department,
        });
    }
    for (const c of src.students) {
        if (!c.card_uid) continue;
        list.push({
            kind: "customer",
            id: c.id,
            uid: c.card_uid,
            name: c.name,
            role: "student",
            isFrozen: c.card_frozen ?? false,
            isActive: c.is_active ?? true,
            customerType: c.school_type,
            identifier: c.student_code || c.customer_code,
            familyCode: c.family_code,
            externalId: c.external_id,
            photoUrl: c.photo_url,
        });
    }
    for (const d of src.departments) {
        if (!d.card_uid) continue;
        list.push({
            kind: "department",
            id: d.id,
            uid: d.card_uid,
            name: d.department_name,
            role: "department",
            isFrozen: !(d.is_active ?? true),
            isActive: d.is_active ?? true,
            identifier: d.department_code,
        });
    }
    for (const o of src.otherCustomers) {
        if (!o.card_uid) continue;
        list.push({
            kind: "customer",
            id: o.id,
            uid: o.card_uid,
            name: o.name,
            role: "other",
            isFrozen: o.card_frozen ?? false,
            isActive: o.is_active ?? true,
            identifier: o.customer_code,
        });
    }
    return list.sort((a, b) => a.uid.localeCompare(b.uid));
}

// ── Role badge ────────────────────────────────────────────────────────────

/**
 * What a customer row's role badge should say.
 *
 * `customerType` carries `school_type` for students and nothing at all for
 * customer_kind='other' rows, so the old `customerType || "Student"` labelled
 * every visitor customer "Student" — a wrong label on real data, not just on
 * the phantom rows above. Falling back to the row's own `role` first means the
 * badge can now only be wrong if `role` is.
 */
export type CustomerBadgeLabel =
    | { source: "customerType"; value: string }
    | { source: "role"; value: string }
    | { source: "studentFallback" };

export function customerBadgeLabel(
    customerType: string | null | undefined,
    role: string | null | undefined,
): CustomerBadgeLabel {
    if (customerType) return { source: "customerType", value: customerType };
    if (role) return { source: "role", value: role };
    // Neither known: this screen has always called an unlabelled customer a
    // student, and every customer source except "other" really is one.
    return { source: "studentFallback" };
}
