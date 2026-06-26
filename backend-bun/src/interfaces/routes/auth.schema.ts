import { t } from "elysia";

export const login = {
    body: t.Object({
        username: t.String(),
        password: t.String(),
    }),
    detail: { tags: ["Auth"], summary: "Login with username and password" },
};

export const refresh = {
    body: t.Object({
        refresh_token: t.String(),
    }),
    detail: { tags: ["Auth"], summary: "Refresh access token" },
};

export const mockSso = {
    body: t.Object({
        email: t.String(),
        full_name: t.Optional(t.Nullable(t.String())),
        provider: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Auth"], summary: "Mock SSO login (dev)" },
};

export const googleSso = {
    body: t.Object({
        access_token: t.String(),
    }),
    detail: { tags: ["Auth"], summary: "Google SSO login" },
};

export const logout = {
    detail: { tags: ["Auth"], summary: "Logout current session" },
};

export const me = {
    detail: { tags: ["Auth"], summary: "Current user profile" },
};

export const jwtMe = {
    detail: { tags: ["Auth"], summary: "JWT claims for current user" },
};

export const listUserRoles = {
    params: t.Object({ user_id: t.String() }),
    detail: { tags: ["Auth"], summary: "List roles for a user (admin)" },
};

export const assignRole = {
    params: t.Object({ user_id: t.String() }),
    body: t.Object({ role_name: t.String() }),
    detail: { tags: ["Auth"], summary: "Assign role to user (admin)" },
};

export const removeRole = {
    params: t.Object({ user_id: t.String(), role_name: t.String() }),
    detail: { tags: ["Auth"], summary: "Remove role from user (admin)" },
};
