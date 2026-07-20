import { t } from "elysia";

export const listUsers = {
    query: t.Object({
        q: t.Optional(t.Nullable(t.String())),
        shop_id: t.Optional(t.Nullable(t.String())),
        role: t.Optional(t.Nullable(t.String())),
        unassigned: t.Optional(t.Nullable(t.String())),
        page: t.Optional(t.Nullable(t.String())),
        page_size: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Admin"], summary: "Paginated user list (admin/manager only)" },
};

export const getUserByUsername = {
    params: t.Object({ username: t.String() }),
    detail: { tags: ["POS"], summary: "Resolve a user payer by username for POS wallet payment" },
};

export const getUserByCard = {
    params: t.Object({ uid: t.String() }),
    detail: { tags: ["POS"], summary: "Resolve a user payer by NFC card UID" },
};

export const getUserByExternalId = {
    params: t.Object({ externalId: t.String() }),
    detail: { tags: ["POS"], summary: "Resolve a user payer by external_id (PowerSchool/HR sync id)" },
};

export const familyLookup = {
    query: t.Object({ q: t.String({ minLength: 1 }) }),
    detail: { tags: ["Admin"], summary: "Lookup by employee username or family code" },
};

export const getUserById = {
    params: t.Object({ id: t.String() }),
    detail: { tags: ["Admin"], summary: "Get a single user by id" },
};

export const createUser = {
    body: t.Object({
        username: t.String({ minLength: 1, maxLength: 50 }),
        password: t.String({ minLength: 6, maxLength: 128 }),
        full_name: t.String({ minLength: 1, maxLength: 255 }),
        role: t.String(),
        shop_id: t.Optional(t.Nullable(t.String())),
        email: t.Optional(t.Nullable(t.String())),
        family_code: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
    }),
    detail: { tags: ["Admin"], summary: "Create a new user account" },
};

export const updateUser = {
    params: t.Object({ id: t.String() }),
    body: t.Object({
        shop_id: t.Optional(t.Nullable(t.String())),
        role: t.Optional(t.Nullable(t.String())),
        full_name: t.Optional(t.Nullable(t.String())),
        is_active: t.Optional(t.Nullable(t.Boolean())),
        email: t.Optional(t.Nullable(t.String())),
        family_code: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
    }),
    detail: { tags: ["Admin"], summary: "Update user account fields" },
};

export const deleteUser = {
    params: t.Object({ id: t.String() }),
    detail: { tags: ["Admin"], summary: "Delete a user account" },
};
