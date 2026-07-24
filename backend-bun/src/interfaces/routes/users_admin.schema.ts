import { t } from "elysia";

export const listAdminUsers = {
    query: t.Object({
        role: t.Optional(t.Nullable(t.String())),
        q: t.Optional(t.Nullable(t.String())),
        status: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Admin"], summary: "Admin user list with has_children + shop_name enrichment" },
};

export const listStaffForPicker = {
    query: t.Object({
        q: t.Optional(t.Nullable(t.String())),
        roles: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Admin"], summary: "Compact staff list for the requisition requester picker" },
};

export const listStudentsForLink = {
    query: t.Object({ q: t.Optional(t.Nullable(t.String())) }),
    detail: { tags: ["Admin"], summary: "Customer rows with student_code set, for the Link Student picker" },
};

export const createAdminStudent = {
    body: t.Object({
        customer_code: t.String(),
        username: t.Optional(t.Nullable(t.String())),
        password: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Admin"], summary: "Create a student user account from customer_code" },
};

export const getAdminUser = {
    params: t.Object({ user_id: t.String() }),
    detail: { tags: ["Admin"], summary: "Get admin user detail by id" },
};

export const updateAdminUser = {
    params: t.Object({ user_id: t.String() }),
    body: t.Object({
        full_name: t.Optional(t.Nullable(t.String())),
        email: t.Optional(t.Nullable(t.String())),
        role: t.Optional(t.Nullable(t.String())),
        external_id: t.Optional(t.Nullable(t.String())),
        external_id_change_reason: t.Optional(t.Nullable(t.String())),
        family_code: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
        photo_url: t.Optional(t.Nullable(t.String())),
        status: t.Optional(t.Nullable(t.String())),
        allergies: t.Optional(t.Nullable(t.String())),
        card_uid: t.Optional(t.Nullable(t.String())),
        customer_type: t.Optional(t.Nullable(t.String())),
        shop_id: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Admin"], summary: "Update admin user profile" },
};

export const getUserFamily = {
    params: t.Object({ user_id: t.String() }),
    detail: { tags: ["Admin"], summary: "List family members linked to a user" },
};

export const updateFamilyProfile = {
    params: t.Object({ family_code: t.String() }),
    body: t.Object({
        notification_emails: t.Optional(t.Nullable(t.Array(t.String()))),
        admin_notification_emails: t.Optional(t.Nullable(t.Array(t.String()))),
        login_ids: t.Optional(t.Nullable(t.Array(t.String()))),
    }),
    detail: { tags: ["Admin"], summary: "Update family notification profile" },
};

export const linkStudentToUser = {
    params: t.Object({ user_id: t.String() }),
    body: t.Object({
        child_customer_id: t.Number(),
        relation: t.Optional(t.Nullable(t.String())),
        parent_rank: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Admin"], summary: "Link a student customer to a parent user" },
};

export const changePassword = {
    params: t.Object({ user_id: t.String() }),
    body: t.Object({ new_password: t.String({ minLength: 8 }) }),
    detail: { tags: ["Admin"], summary: "Admin change password for a user" },
};

export const unlinkStudent = {
    params: t.Object({
        user_id: t.String(),
        customer_id: t.String(),
    }),
    detail: { tags: ["Admin"], summary: "Unlink a student from a parent user" },
};
