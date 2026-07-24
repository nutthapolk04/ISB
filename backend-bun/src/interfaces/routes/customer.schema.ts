import { t } from "elysia";

export const searchCustomers = {
    query: t.Object({
        q: t.String({ minLength: 1 }),
        limit: t.Optional(t.Nullable(t.String())),
        // "1"/"true" — restrict matching to name + family_code + external_id
        // + card_uid only (used by the POS member-search box; see searchCustomers()).
        narrow: t.Optional(t.Nullable(t.String())),
    }),
    detail: {
        tags: ["Customers"],
        summary: "Search customers/users",
        description:
            "Searches Customer + User tables. Returns StudentProfileResponse rows. user_id != null indicates a user-payer flow.",
    },
};

export const getCustomerByCode = {
    params: t.Object({ code: t.String() }),
    detail: { tags: ["Customers"], summary: "Lookup by student_code or customer_code" },
};

export const getCustomerByCard = {
    params: t.Object({ uid: t.String() }),
    detail: { tags: ["Customers"], summary: "Lookup by NFC card UID" },
};

export const listCustomers = {
    query: t.Object({
        skip: t.Optional(t.Nullable(t.String())),
        limit: t.Optional(t.Nullable(t.String())),
        search: t.Optional(t.Nullable(t.String())),
        is_active: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Customers"], summary: "List customers (paginated)" },
};

export const getCustomerById = {
    params: t.Object({ id: t.String() }),
    detail: { tags: ["Customers"], summary: "Get customer by numeric id" },
};

export const createCustomer = {
    body: t.Object({
        customer_code: t.String(),
        name: t.String(),
        student_code: t.Optional(t.Nullable(t.String())),
        grade: t.Optional(t.Nullable(t.String())),
        email: t.Optional(t.Nullable(t.String())),
        phone: t.Optional(t.Nullable(t.String())),
        allergies: t.Optional(t.Nullable(t.String())),
        dietary_notes: t.Optional(t.Nullable(t.String())),
        card_uid: t.Optional(t.Nullable(t.String())),
        photo_url: t.Optional(t.Nullable(t.String())),
        customer_type_id: t.Optional(t.Nullable(t.Number())),
        initial_balance: t.Optional(t.Nullable(t.Number())),
    }),
    detail: { tags: ["Customers"], summary: "Create student customer (admin)" },
};

export const updateCustomer = {
    params: t.Object({ id: t.String() }),
    body: t.Object({
        name: t.Optional(t.Nullable(t.String())),
        grade: t.Optional(t.Nullable(t.String())),
        school_type: t.Optional(t.Nullable(t.String())),
        email: t.Optional(t.Nullable(t.String())),
        phone: t.Optional(t.Nullable(t.String())),
        family_code: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Customers"], summary: "Update customer basic fields (admin)" },
};

export const deleteCustomer = {
    params: t.Object({ id: t.String() }),
    detail: { tags: ["Customers"], summary: "Delete customer (admin)" },
};

export const freezeCustomerCard = {
    params: t.Object({ id: t.String() }),
    body: t.Object({ frozen: t.Boolean() }),
    detail: { tags: ["Customers"], summary: "Freeze or unfreeze customer card" },
};

export const setCustomerActive = {
    params: t.Object({ id: t.String() }),
    body: t.Object({ active: t.Boolean() }),
    detail: { tags: ["Customers"], summary: "Set customer active flag (admin)" },
};

export const setCustomerLimit = {
    params: t.Object({ id: t.String() }),
    body: t.Object({
        daily_limit: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
        daily_limit_canteen: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
        daily_limit_store: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
    }),
    detail: { tags: ["Customers"], summary: "Set daily spending limit(s)" },
};

export const updateCustomerAllergies = {
    params: t.Object({ id: t.String() }),
    body: t.Object({
        allergies: t.Optional(t.Nullable(t.String())),
        dietary_notes: t.Optional(t.Nullable(t.String())),
        allergy_override_note: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Customers"], summary: "Update allergies and dietary notes" },
};

export const setCustomerNegativeLimit = {
    params: t.Object({ id: t.String() }),
    body: t.Object({ negative_credit_limit: t.Optional(t.Nullable(t.Number({ minimum: 0 }))) }),
    detail: { tags: ["Customers"], summary: "Set negative credit limit (admin)" },
};

export const bindCustomerCard = {
    params: t.Object({ id: t.String() }),
    body: t.Object({ card_uid: t.Optional(t.Nullable(t.String())) }),
    detail: { tags: ["Customers"], summary: "Bind or unbind NFC card (admin)" },
};

export const graduateCustomer = {
    params: t.Object({ id: t.String() }),
    body: t.Object({
        transfer_to_customer_id: t.Optional(t.Nullable(t.Number({ minimum: 1 }))),
    }),
    detail: { tags: ["Customers"], summary: "Graduate student and optionally transfer balance (admin)" },
};
