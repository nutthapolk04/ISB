import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { flushSync } from "react-dom";
import { API_BASE_URL } from "@/lib/constants";
import { autoOpenCustomerDisplayWindow } from "@/lib/customerDisplayWindow";

// Multi-role / Switch role feature — disabled per request. Flip back to
// `true` to restore (RolePicker, HomeHub role tiles, and the header's
// "Switch role" button all key off this single flag).
const MULTI_ROLE_ENABLED = false;

export type UserRole =
    | "admin"
    | "manager"
    | "cashier"
    | "parent"
    | "student"
    | "staff"
    | "teacher"
    | "kitchen"
    | "canteen_owner"
    | "refund_officer"
    | "finance";
/** Shop id is a free-form string now — canteens can have many sub-shops (e.g. canteen_thai) */
export type ShopId = string;
/** Functional module drives which POS/UI a user sees. */
export type AppModule = "canteen" | "store";

export interface AuthUser {
    id: number;
    username: string;
    fullName: string;
    role: UserRole;
    /** All roles assigned to this user (primary + secondary), deduplicated. */
    allRoles: UserRole[];
    /** Currently active role — may differ from `role` after role-picker selection. */
    activeRole: UserRole;
    /** null = access to all shops (admin / manager) */
    shopId: ShopId | null;
    shopName: string | null;
    /** Derived from the shop's `module` column at login; null for admins or users without shop. */
    shopModule: AppModule | null;
    /** Non-null when this user is linked as a parent/guardian (has children). */
    familyCode?: string | null;
}

interface AuthContextValue {
    user: AuthUser | null;
    isAuthenticated: boolean;
    login: (username: string, password: string) => Promise<{ success: boolean; error?: string; allRoles?: UserRole[] }>;
    loginWithMockSSO: (email: string, fullName?: string) => Promise<{ success: boolean; error?: string; allRoles?: UserRole[] }>;
    loginWithGoogleCode: (code: string, redirectUri: string) => Promise<{ success: boolean; error?: string; allRoles?: UserRole[] }>;
    logout: () => void;
    hasRole: (...roles: UserRole[]) => boolean;
    hasShopAccess: (shopId: ShopId) => boolean;
    setActiveRole: (role: UserRole) => void;
}

// Role mapping from backend user data
// Backend seed only has "admin" user; for demo, mock users still work as fallback
const MOCK_USERS: (AuthUser & { password: string })[] = [
    { id: 1, username: "admin", password: "admin1234", fullName: "Administrator", role: "admin", allRoles: ["admin"], activeRole: "admin", shopId: null, shopName: null, shopModule: null },
    { id: 2, username: "manager_coop", password: "manager", fullName: "Manager (Coop)", role: "manager", allRoles: ["manager"], activeRole: "manager", shopId: "coop", shopName: "Coop Shop", shopModule: "store" },
    { id: 7, username: "manager_sports", password: "manager", fullName: "Manager (Sports)", role: "manager", allRoles: ["manager"], activeRole: "manager", shopId: "sports", shopName: "Sports Shop", shopModule: "store" },
    { id: 9, username: "manager_book", password: "manager", fullName: "Manager (Book)", role: "manager", allRoles: ["manager"], activeRole: "manager", shopId: "bookstore", shopName: "Bookstore", shopModule: "store" },
    { id: 3, username: "cashier_coop", password: "cashier", fullName: "Cashier (Coop)", role: "cashier", allRoles: ["cashier"], activeRole: "cashier", shopId: "coop", shopName: "Coop Shop", shopModule: "store" },
    { id: 4, username: "cashier_sports", password: "cashier", fullName: "Cashier (Sports)", role: "cashier", allRoles: ["cashier"], activeRole: "cashier", shopId: "sports", shopName: "Sports Shop", shopModule: "store" },
    { id: 6, username: "cashier_book", password: "cashier", fullName: "Cashier (Book)", role: "cashier", allRoles: ["cashier"], activeRole: "cashier", shopId: "bookstore", shopName: "Bookstore", shopModule: "store" },
    { id: 10, username: "manager_canteen", password: "manager", fullName: "Manager (Canteen)", role: "manager", allRoles: ["manager"], activeRole: "manager", shopId: "canteen", shopName: "ISB Canteen", shopModule: "canteen" },
    { id: 16, username: "manager_canteen_area", password: "manager", fullName: "Manager (Canteen Area)", role: "manager", allRoles: ["manager"], activeRole: "manager", shopId: null, shopName: "All Canteen Stalls", shopModule: "canteen" },
    { id: 11, username: "cashier_canteen", password: "cashier", fullName: "Cashier (Canteen)", role: "cashier", allRoles: ["cashier"], activeRole: "cashier", shopId: "canteen", shopName: "ISB Canteen", shopModule: "canteen" },
    { id: 12, username: "manager_canteen_thai", password: "manager", fullName: "Manager (Thai Kitchen)", role: "manager", allRoles: ["manager"], activeRole: "manager", shopId: "canteen_thai", shopName: "Thai Kitchen", shopModule: "canteen" },
    { id: 13, username: "cashier_canteen_thai", password: "cashier", fullName: "Cashier (Thai Kitchen)", role: "cashier", allRoles: ["cashier"], activeRole: "cashier", shopId: "canteen_thai", shopName: "Thai Kitchen", shopModule: "canteen" },
    { id: 14, username: "manager_canteen_drinks", password: "manager", fullName: "Manager (Drinks & Snacks)", role: "manager", allRoles: ["manager"], activeRole: "manager", shopId: "canteen_drinks", shopName: "Drinks & Snacks", shopModule: "canteen" },
    { id: 15, username: "cashier_canteen_drinks", password: "cashier", fullName: "Cashier (Drinks & Snacks)", role: "cashier", allRoles: ["cashier"], activeRole: "cashier", shopId: "canteen_drinks", shopName: "Drinks & Snacks", shopModule: "canteen" },
    // Refund officer (handles refund requests across shops)
    { id: 17, username: "refund_officer", password: "refund", fullName: "Refund Officer", role: "refund_officer", allRoles: ["refund_officer"], activeRole: "refund_officer", shopId: null, shopName: null, shopModule: null },
    // PowerSchool staff (has_children=true — demo: staff + parent dual-role)
    { id: 202301, username: "somchair", password: "parent", fullName: "Somchai RAKDEE", role: "staff", allRoles: ["staff", "parent"], activeRole: "staff", shopId: null, shopName: null, shopModule: null, familyCode: "FAM202301" },
    { id: 202303, username: "prasitj", password: "parent", fullName: "Prasit JAIDEE", role: "staff", allRoles: ["staff", "parent"], activeRole: "staff", shopId: null, shopName: null, shopModule: null, familyCode: "FAM202303" },
    { id: 202304, username: "wanidaj", password: "parent", fullName: "Wanida JAIDEE", role: "staff", allRoles: ["staff", "parent"], activeRole: "staff", shopId: null, shopName: null, shopModule: null, familyCode: "FAM202304" },
    { id: 202306, username: "porntips", password: "parent", fullName: "Pornthip SUWAN", role: "staff", allRoles: ["staff", "parent"], activeRole: "staff", shopId: null, shopName: null, shopModule: null, familyCode: "FAM202306" },
    // PowerSchool staff (no children — single role)
    { id: 202468, username: "jirawatj", password: "parent", fullName: "Jirawat JIRACHAISOPIT", role: "staff", allRoles: ["staff"], activeRole: "staff", shopId: null, shopName: null, shopModule: null },
    { id: 202266, username: "phatthab", password: "parent", fullName: "Phatthara BUNLUESIN", role: "staff", allRoles: ["staff"], activeRole: "staff", shopId: null, shopName: null, shopModule: null },
    { id: 201210, username: "angkanan", password: "parent", fullName: "Angkana PROMESIRISAN", role: "staff", allRoles: ["staff"], activeRole: "staff", shopId: null, shopName: null, shopModule: null },
    { id: 201450, username: "chadb", password: "parent", fullName: "Chad Crawford BATES", role: "staff", allRoles: ["staff"], activeRole: "staff", shopId: null, shopName: null, shopModule: null },
    { id: 201208, username: "narino", password: "parent", fullName: "Narin ONGARTHACHAT", role: "staff", allRoles: ["staff"], activeRole: "staff", shopId: null, shopName: null, shopModule: null },
    { id: 201274, username: "tua", password: "parent", fullName: "Sathaporn SOMCHIT", role: "staff", allRoles: ["staff"], activeRole: "staff", shopId: null, shopName: null, shopModule: null },
    { id: 201213, username: "suttinel", password: "parent", fullName: "Suttinee AVUSOSAKUL", role: "staff", allRoles: ["staff"], activeRole: "staff", shopId: null, shopName: null, shopModule: null },
    { id: 200990, username: "thitaphp", password: "parent", fullName: "Thitaphong PISITSIRIKUL", role: "staff", allRoles: ["staff"], activeRole: "staff", shopId: null, shopName: null, shopModule: null },
    // PowerSchool parents
    { id: 85001, username: "85001", password: "parent", fullName: "John Wick", role: "parent", allRoles: ["parent"], activeRole: "parent", shopId: null, shopName: null, shopModule: null },
    { id: 85002, username: "85002", password: "parent", fullName: "Kate Wick", role: "parent", allRoles: ["parent"], activeRole: "parent", shopId: null, shopName: null, shopModule: null },
    { id: 85003, username: "85003", password: "parent", fullName: "Brad Pitt", role: "parent", allRoles: ["parent"], activeRole: "parent", shopId: null, shopName: null, shopModule: null },
    { id: 70652, username: "70652", password: "parent", fullName: "Kritsada SUWAN", role: "parent", allRoles: ["parent"], activeRole: "parent", shopId: null, shopName: null, shopModule: null },
    { id: 70699, username: "70699", password: "parent", fullName: "Malee RAKDEE", role: "parent", allRoles: ["parent"], activeRole: "parent", shopId: null, shopName: null, shopModule: null },
    // Hybrid parent+manager
    { id: 85100, username: "john_smith99", password: "parent", fullName: "John Smith", role: "parent", allRoles: ["parent", "manager"], activeRole: "parent", shopId: "coop", shopName: "Coop Shop", shopModule: "store", familyCode: "FAM85100" },
];

/**
 * Infer module from a shop id as a *fallback* when the user's shopModule
 * is not yet loaded. Convention: any shopId starting with "canteen" is a
 * canteen shop; everything else (coop, sports, bookstore, …) is store.
 * Prefer `user.shopModule` (authoritative from backend) when available.
 */
export function moduleOf(shopId: ShopId | null | undefined): AppModule | null {
    if (!shopId) return null;
    if (shopId === "canteen" || shopId.startsWith("canteen_")) return "canteen";
    return "store";
}

const STORAGE_KEY = "schooney_auth_user";
const TOKEN_KEY = "access_token";

/**
 * Reads the `sub` claim out of a JWT's payload without verifying its
 * signature — this is a client-side sanity check only (the backend already
 * verifies every token on every request); it exists purely to detect when
 * the *shared* localStorage token no longer belongs to the user this tab
 * thinks is logged in. Returns null on any malformed/unexpected token.
 */
function decodeJwtSub(token: string): number | null {
    try {
        const payloadB64 = token.split(".")[1];
        const json = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));
        const payload = JSON.parse(json) as { sub?: string | number };
        return payload.sub != null ? Number(payload.sub) : null;
    } catch {
        return null;
    }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) return null;
            const parsed: AuthUser = JSON.parse(stored);
            // Backward compat: old sessions lack allRoles/activeRole
            parsed.allRoles = MULTI_ROLE_ENABLED ? (parsed.allRoles ?? [parsed.role]) : [parsed.role];
            parsed.activeRole = MULTI_ROLE_ENABLED ? (parsed.activeRole ?? parsed.role) : parsed.role;
            return parsed;
        } catch {
            return null;
        }
    });

    const isAuthenticated = user !== null;

    // Auto-open the customer display once per fresh session — but ONLY for
    // single-role cashier/manager accounts on a desktop pointer. Hybrid
    // accounts (manager+parent etc.) land on the Hub and shouldn't get a
    // surprise second window before they pick a role; mobile users have no
    // second monitor to host it.
    //
    // Once the user actually enters /store or /canteen, those pages will
    // pop the display themselves regardless of how they got there.
    const autoOpenedRef = useRef(false);
    useEffect(() => {
        const POS_ROLES: ReadonlyArray<UserRole> = ["cashier", "manager"];
        if (!user) { autoOpenedRef.current = false; return; }

        const runsPos = POS_ROLES.includes(user.activeRole ?? user.role);
        const allRoles = user.allRoles ?? [user.role];
        const isSingleRole = allRoles.length <= 1;
        const isMobile =
            typeof window !== "undefined" &&
            window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;

        if (runsPos && isSingleRole && !isMobile && !autoOpenedRef.current) {
            autoOpenedRef.current = true;
            void autoOpenCustomerDisplayWindow();
        }
    }, [user]);

    // Shared-browser / shared-kiosk safety net. `access_token`/`refresh_token`/
    // STORAGE_KEY live in localStorage, which every tab of the same browser
    // shares — a second person logging in on another tab (or even this tab's
    // own silent 401→refresh in api.ts picking up a refresh_token someone
    // else's login already overwrote) replaces the credentials out from
    // under this tab without it knowing. Since every API call re-reads the
    // token fresh from localStorage at call time (api.ts) while this tab's
    // `user` state was only ever set once at login, the two would silently
    // drift apart — the navbar keeps showing the old person while every new
    // API response is actually the new person's data. `storage` only fires
    // in tabs OTHER than the one that made the change, which is exactly the
    // idle tab we need to protect. Detect the mismatch and force a clean
    // re-login rather than let this tab keep mixing two identities.
    useEffect(() => {
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key !== TOKEN_KEY && e.key !== STORAGE_KEY) return;
            if (!user) return;

            const currentToken = localStorage.getItem(TOKEN_KEY);
            if (!currentToken) {
                // Another tab logged out — the shared credentials this tab
                // relies on are gone too.
                setUser(null);
                return;
            }
            const tokenSub = decodeJwtSub(currentToken);
            if (tokenSub !== null && tokenSub !== user.id) {
                setUser(null);
                window.location.href = "/login";
            }
        };
        window.addEventListener("storage", handleStorageChange);
        return () => window.removeEventListener("storage", handleStorageChange);
    }, [user]);

    const login = async (
        username: string,
        password: string,
    ): Promise<{ success: boolean; error?: string; allRoles?: UserRole[] }> => {
        try {
            const res = await fetch(`${API_BASE_URL}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password }),
            });

            if (!res.ok) {
                let detail = "Invalid username or password";
                try {
                    const body = await res.json();
                    detail = body.detail ?? detail;
                } catch {
                    /* keep fallback */
                }

                // Prototype mock fallback — lets demo accounts login even if backend
                // is stale/down. Safe because mock credentials are well-known (docs).
                const found = MOCK_USERS.find(
                    (u) => u.username.toLowerCase() === username.toLowerCase() && u.password === password,
                );
                if (found) {
                    const { password: _pw, ...authUser } = found;
                    // Reset activeRole to primary on each fresh login
                    authUser.activeRole = authUser.role;
                    if (!MULTI_ROLE_ENABLED) authUser.allRoles = [authUser.role];
                    flushSync(() => setUser(authUser));
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
                    console.warn(
                        "[AuthContext] mock fallback — backend returned",
                        res.status,
                        "(prototype demo mode)",
                    );
                    return { success: true, allRoles: authUser.allRoles };
                }
                return { success: false, error: detail };
            }

            const data = await res.json();
            localStorage.setItem(TOKEN_KEY, data.access_token);
            if (data.refresh_token) {
                localStorage.setItem("refresh_token", data.refresh_token);
            }

            const meRes = await fetch(`${API_BASE_URL}/auth/me`, {
                headers: { Authorization: `Bearer ${data.access_token}` },
            });

            let authUser: AuthUser;
            if (meRes.ok) {
                const meData = await meRes.json();
                const backendUser = meData.user ?? meData;
                const backendRole = backendUser.role as UserRole | undefined;
                const mockMatch = MOCK_USERS.find((u) => u.username.toLowerCase() === username.toLowerCase());
                const resolvedRole: UserRole =
                    backendRole ??
                    mockMatch?.role ??
                    (backendUser.is_superuser ? "admin" : "cashier");
                // Collect all roles from backend roles[] array
                const secondaryRoles: UserRole[] = (backendUser.roles ?? [])
                    .map((r: { name: string }) => r.name as UserRole)
                    .filter((r: UserRole) => r !== resolvedRole);
                const familyCode = backendUser.family_code ?? null;
                // If user has a family_code they are also a parent/guardian — infer the role
                // even when the backend omits it from the secondary roles list.
                if (familyCode && !secondaryRoles.includes("parent" as UserRole) && resolvedRole !== "parent") {
                    secondaryRoles.push("parent" as UserRole);
                }
                // If a non-shop user has a shop_id assigned in the backend, they also operate
                // that shop — infer manager role so the Role Picker and User Guide reflect it.
                const SHOP_ROLES: UserRole[] = ["manager", "cashier", "kitchen", "canteen_owner"];
                const hasShopRole = SHOP_ROLES.includes(resolvedRole) || secondaryRoles.some(r => SHOP_ROLES.includes(r));
                if (backendUser.shop_id && !hasShopRole) {
                    secondaryRoles.push("manager" as UserRole);
                }
                const allRoles: UserRole[] = MULTI_ROLE_ENABLED
                    ? [...new Set([resolvedRole, ...secondaryRoles])]
                    : [resolvedRole];
                const shopId = backendUser.shop_id ?? mockMatch?.shopId ?? null;
                // shop_module from backend wins; fall back to mock match or heuristic
                const backendModule = (backendUser.shop_module as AppModule | undefined) ?? null;
                authUser = {
                    id: backendUser.id,
                    username: backendUser.username,
                    fullName: backendUser.full_name ?? backendUser.username,
                    role: resolvedRole,
                    allRoles,
                    activeRole: resolvedRole,
                    shopId,
                    shopName: mockMatch?.shopName ?? null,
                    shopModule: backendModule ?? mockMatch?.shopModule ?? moduleOf(shopId),
                    familyCode,
                };
                // Always fetch shop metadata when user has a shopId to get the real shop name.
                // Only update shopModule when backend didn't already provide it.
                if (shopId) {
                    try {
                        const shopRes = await fetch(`${API_BASE_URL}/shops/${shopId}`, {
                            headers: { Authorization: `Bearer ${data.access_token}` },
                        });
                        if (shopRes.ok) {
                            const shop = await shopRes.json();
                            if (!backendModule) {
                                authUser.shopModule = (shop.module as AppModule) ?? authUser.shopModule;
                            }
                            authUser.shopName = shop.name ?? authUser.shopName;
                        }
                    } catch { /* keep inferred values */ }
                }
            } else {
                const mockMatch = MOCK_USERS.find((u) => u.username.toLowerCase() === username.toLowerCase());
                authUser = mockMatch
                    ? {
                        id: mockMatch.id, username: mockMatch.username, fullName: mockMatch.fullName,
                        role: mockMatch.role, allRoles: MULTI_ROLE_ENABLED ? mockMatch.allRoles : [mockMatch.role], activeRole: mockMatch.role,
                        shopId: mockMatch.shopId, shopName: mockMatch.shopName, shopModule: mockMatch.shopModule,
                    }
                    : { id: 0, username, fullName: username, role: "cashier", allRoles: ["cashier"], activeRole: "cashier", shopId: null, shopName: null, shopModule: null };
            }

            flushSync(() => setUser(authUser));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
            return { success: true, allRoles: authUser.allRoles };
        } catch {
            // Offline mock fallback (prototype demo) — backend unreachable
            const found = MOCK_USERS.find(
                (u) => u.username.toLowerCase() === username.toLowerCase() && u.password === password,
            );
            if (found) {
                const { password: _pw, ...authUser } = found;
                authUser.activeRole = authUser.role;
                if (!MULTI_ROLE_ENABLED) authUser.allRoles = [authUser.role];
                flushSync(() => setUser(authUser));
                localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
                console.warn(
                    "[AuthContext] offline mock fallback — backend unreachable (prototype demo mode)",
                );
                return { success: true, allRoles: authUser.allRoles };
            }
            return { success: false, error: "Cannot reach server. Please try again." };
        }
    };

    const loginWithMockSSO = async (
        email: string,
        fullName?: string,
    ): Promise<{ success: boolean; error?: string; allRoles?: UserRole[] }> => {
        try {
            const res = await fetch(`${API_BASE_URL}/auth/sso/mock`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, full_name: fullName, provider: "mock" }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: "SSO login failed" }));
                return { success: false, error: err.detail };
            }
            const data = await res.json();
            localStorage.setItem(TOKEN_KEY, data.access_token);
            if (data.refresh_token) {
                localStorage.setItem("refresh_token", data.refresh_token);
            }
            // Fetch /me
            const meRes = await fetch(`${API_BASE_URL}/auth/me`, {
                headers: { Authorization: `Bearer ${data.access_token}` },
            });
            if (!meRes.ok) {
                return { success: false, error: "Failed to load profile" };
            }
            const meData = await meRes.json();
            const backendUser = meData.user ?? meData;
            const resolvedRole: UserRole = (backendUser.role as UserRole) ?? "parent";
            const secondaryRoles: UserRole[] = (backendUser.roles ?? [])
                .map((r: { name: string }) => r.name as UserRole)
                .filter((r: UserRole) => r !== resolvedRole);
            const allRoles: UserRole[] = MULTI_ROLE_ENABLED
                ? [...new Set([resolvedRole, ...secondaryRoles])]
                : [resolvedRole];
            const shopId = backendUser.shop_id ?? null;
            const backendModule = (backendUser.shop_module as AppModule | undefined) ?? null;
            const authUser: AuthUser = {
                id: backendUser.id,
                username: backendUser.username,
                fullName: backendUser.full_name ?? backendUser.username,
                role: resolvedRole,
                allRoles,
                activeRole: resolvedRole,
                shopId,
                shopName: backendUser.shop_name ?? null,
                shopModule: backendModule ?? moduleOf(shopId),
            };
            flushSync(() => setUser(authUser));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
            // Enrich shop metadata async if needed
            if (shopId && !backendModule) {
                fetch(`${API_BASE_URL}/shops/${shopId}`, {
                    headers: { Authorization: `Bearer ${data.access_token}` },
                })
                    .then((r) => r.ok ? r.json() : null)
                    .then((shop) => {
                        if (!shop) return;
                        const enriched = { ...authUser, shopModule: (shop.module as AppModule) ?? authUser.shopModule, shopName: shop.name ?? authUser.shopName };
                        setUser(enriched);
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(enriched));
                    })
                    .catch(() => { });
            }
            return { success: true, allRoles };
        } catch (e: any) {
            return { success: false, error: e?.message ?? "SSO unavailable" };
        }
    };

    const loginWithGoogleCode = async (
        code: string,
        redirectUri: string,
    ): Promise<{ success: boolean; error?: string; allRoles?: UserRole[] }> => {
        try {
            const res = await fetch(`${API_BASE_URL}/auth/sso/google/callback`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code, redirect_uri: redirectUri }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: "Google login failed" }));
                return { success: false, error: err.detail };
            }
            const data = await res.json();
            localStorage.setItem(TOKEN_KEY, data.access_token);
            if (data.refresh_token) localStorage.setItem("refresh_token", data.refresh_token);

            const meRes = await fetch(`${API_BASE_URL}/auth/me`, {
                headers: { Authorization: `Bearer ${data.access_token}` },
            });
            if (!meRes.ok) return { success: false, error: "Failed to load profile" };

            const meData = await meRes.json();
            const backendUser = meData.user ?? meData;
            const resolvedRole: UserRole = (backendUser.role as UserRole) ?? "parent";
            const secondaryRoles: UserRole[] = (backendUser.roles ?? [])
                .map((r: { name: string }) => r.name as UserRole)
                .filter((r: UserRole) => r !== resolvedRole);
            const allRoles: UserRole[] = MULTI_ROLE_ENABLED
                ? [...new Set([resolvedRole, ...secondaryRoles])]
                : [resolvedRole];
            const shopId = backendUser.shop_id ?? null;
            const backendModule = (backendUser.shop_module as AppModule | undefined) ?? null;
            const authUser: AuthUser = {
                id: backendUser.id,
                username: backendUser.username,
                fullName: backendUser.full_name ?? backendUser.username,
                role: resolvedRole,
                allRoles,
                activeRole: resolvedRole,
                shopId,
                shopName: backendUser.shop_name ?? null,
                shopModule: backendModule ?? moduleOf(shopId),
            };
            flushSync(() => setUser(authUser));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));

            if (shopId && !backendModule) {
                fetch(`${API_BASE_URL}/shops/${shopId}`, {
                    headers: { Authorization: `Bearer ${data.access_token}` },
                })
                    .then((r) => r.ok ? r.json() : null)
                    .then((shop) => {
                        if (!shop) return;
                        const enriched = { ...authUser, shopModule: (shop.module as AppModule) ?? authUser.shopModule, shopName: shop.name ?? authUser.shopName };
                        setUser(enriched);
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(enriched));
                    })
                    .catch(() => { });
            }
            return { success: true, allRoles };
        } catch (e: any) {
            return { success: false, error: e?.message ?? "Google login unavailable" };
        }
    };

    const logout = () => {
        setUser(null);
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem("refresh_token");
    };

    const hasRole = (...roles: UserRole[]): boolean => {
        if (!user) return false;
        // RBAC checks should reflect *capabilities*, not the current UI mode.
        // A hybrid manager+parent user must be able to enter parent routes
        // even while their session's activeRole is "manager" — otherwise the
        // multi-role experience collapses to whichever role they picked first.
        const allowed = new Set<UserRole>(user.allRoles ?? [user.role]);
        allowed.add(user.activeRole ?? user.role);
        return roles.some((r) => allowed.has(r));
    };

    const hasShopAccess = (shopId: ShopId): boolean =>
        user?.role === "admin" || user?.shopId === shopId;

    const setActiveRole = (role: UserRole) => {
        if (!user || !MULTI_ROLE_ENABLED) return;
        const updated: AuthUser = { ...user, activeRole: role };
        setUser(updated);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    };

    return (
        <AuthContext.Provider value={{ user, isAuthenticated, login, loginWithMockSSO, loginWithGoogleCode, logout, hasRole, hasShopAccess, setActiveRole }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
}
