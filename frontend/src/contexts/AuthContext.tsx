import { createContext, useContext, useState, ReactNode } from "react";
import { API_BASE_URL } from "@/lib/constants";

export type UserRole =
  | "admin"
  | "manager"
  | "cashier"
  | "parent"
  | "student"
  | "staff"
  | "teacher"
  | "kitchen"
  | "canteen_owner";
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
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  loginWithMockSSO: (email: string, fullName?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  hasRole: (...roles: UserRole[]) => boolean;
  hasShopAccess: (shopId: ShopId) => boolean;
  setActiveRole: (role: UserRole) => void;
}

// Role mapping from backend user data
// Backend seed only has "admin" user; for demo, mock users still work as fallback
const MOCK_USERS: (AuthUser & { password: string })[] = [
  { id: 1,  username: "admin",                   password: "admin1234", fullName: "Administrator",                 role: "admin",   allRoles: ["admin"],             activeRole: "admin",   shopId: null,             shopName: null,                shopModule: null      },
  { id: 2,  username: "manager_coop",            password: "manager",   fullName: "Manager (Coop)",                role: "manager", allRoles: ["manager"],           activeRole: "manager", shopId: "coop",           shopName: "Coop Shop",         shopModule: "store"   },
  { id: 7,  username: "manager_sports",          password: "manager",   fullName: "Manager (Sports)",              role: "manager", allRoles: ["manager"],           activeRole: "manager", shopId: "sports",         shopName: "Sports Shop",       shopModule: "store"   },
  { id: 9,  username: "manager_book",            password: "manager",   fullName: "Manager (Book)",                role: "manager", allRoles: ["manager"],           activeRole: "manager", shopId: "bookstore",      shopName: "Bookstore",         shopModule: "store"   },
  { id: 3,  username: "cashier_coop",            password: "cashier",   fullName: "Cashier (Coop)",                role: "cashier", allRoles: ["cashier"],           activeRole: "cashier", shopId: "coop",           shopName: "Coop Shop",         shopModule: "store"   },
  { id: 4,  username: "cashier_sports",          password: "cashier",   fullName: "Cashier (Sports)",              role: "cashier", allRoles: ["cashier"],           activeRole: "cashier", shopId: "sports",         shopName: "Sports Shop",       shopModule: "store"   },
  { id: 6,  username: "cashier_book",            password: "cashier",   fullName: "Cashier (Book)",                role: "cashier", allRoles: ["cashier"],           activeRole: "cashier", shopId: "bookstore",      shopName: "Bookstore",         shopModule: "store"   },
  { id: 10, username: "manager_canteen",         password: "manager",   fullName: "Manager (Canteen)",             role: "manager", allRoles: ["manager"],           activeRole: "manager", shopId: "canteen",        shopName: "ISB Canteen",       shopModule: "canteen" },
  { id: 11, username: "cashier_canteen",         password: "cashier",   fullName: "Cashier (Canteen)",             role: "cashier", allRoles: ["cashier"],           activeRole: "cashier", shopId: "canteen",        shopName: "ISB Canteen",       shopModule: "canteen" },
  { id: 12, username: "manager_canteen_thai",    password: "manager",   fullName: "Manager (Thai Kitchen)",        role: "manager", allRoles: ["manager"],           activeRole: "manager", shopId: "canteen_thai",   shopName: "Thai Kitchen",      shopModule: "canteen" },
  { id: 13, username: "cashier_canteen_thai",    password: "cashier",   fullName: "Cashier (Thai Kitchen)",        role: "cashier", allRoles: ["cashier"],           activeRole: "cashier", shopId: "canteen_thai",   shopName: "Thai Kitchen",      shopModule: "canteen" },
  { id: 14, username: "manager_canteen_drinks",  password: "manager",   fullName: "Manager (Drinks & Snacks)",     role: "manager", allRoles: ["manager"],           activeRole: "manager", shopId: "canteen_drinks", shopName: "Drinks & Snacks",   shopModule: "canteen" },
  { id: 15, username: "cashier_canteen_drinks",  password: "cashier",   fullName: "Cashier (Drinks & Snacks)",     role: "cashier", allRoles: ["cashier"],           activeRole: "cashier", shopId: "canteen_drinks", shopName: "Drinks & Snacks",   shopModule: "canteen" },
  // PowerSchool staff (has_children=true — demo: staff + parent dual-role)
  { id: 202301, username: "somchair",  password: "parent", fullName: "Somchai RAKDEE",           role: "staff", allRoles: ["staff", "parent"], activeRole: "staff", shopId: null, shopName: null, shopModule: null },
  { id: 202303, username: "prasitj",   password: "parent", fullName: "Prasit JAIDEE",            role: "staff", allRoles: ["staff", "parent"], activeRole: "staff", shopId: null, shopName: null, shopModule: null },
  { id: 202304, username: "wanidaj",   password: "parent", fullName: "Wanida JAIDEE",            role: "staff", allRoles: ["staff", "parent"], activeRole: "staff", shopId: null, shopName: null, shopModule: null },
  { id: 202306, username: "porntips",  password: "parent", fullName: "Pornthip SUWAN",           role: "staff", allRoles: ["staff", "parent"], activeRole: "staff", shopId: null, shopName: null, shopModule: null },
  // PowerSchool staff (no children — single role)
  { id: 202468, username: "jirawatj",  password: "parent", fullName: "Jirawat JIRACHAISOPIT",    role: "staff", allRoles: ["staff"], activeRole: "staff", shopId: null, shopName: null, shopModule: null },
  { id: 202266, username: "phatthab",  password: "parent", fullName: "Phatthara BUNLUESIN",      role: "staff", allRoles: ["staff"], activeRole: "staff", shopId: null, shopName: null, shopModule: null },
  { id: 201210, username: "angkanan",  password: "parent", fullName: "Angkana PROMESIRISAN",     role: "staff", allRoles: ["staff"], activeRole: "staff", shopId: null, shopName: null, shopModule: null },
  { id: 201450, username: "chadb",     password: "parent", fullName: "Chad Crawford BATES",      role: "staff", allRoles: ["staff"], activeRole: "staff", shopId: null, shopName: null, shopModule: null },
  { id: 201208, username: "narino",    password: "parent", fullName: "Narin ONGARTHACHAT",       role: "staff", allRoles: ["staff"], activeRole: "staff", shopId: null, shopName: null, shopModule: null },
  { id: 201274, username: "tua",       password: "parent", fullName: "Sathaporn SOMCHIT",        role: "staff", allRoles: ["staff"], activeRole: "staff", shopId: null, shopName: null, shopModule: null },
  { id: 201213, username: "suttinel",  password: "parent", fullName: "Suttinee AVUSOSAKUL",      role: "staff", allRoles: ["staff"], activeRole: "staff", shopId: null, shopName: null, shopModule: null },
  { id: 200990, username: "thitaphp",  password: "parent", fullName: "Thitaphong PISITSIRIKUL",  role: "staff", allRoles: ["staff"], activeRole: "staff", shopId: null, shopName: null, shopModule: null },
  // PowerSchool parents
  { id: 85001,  username: "85001",     password: "parent", fullName: "John Wick",                role: "parent", allRoles: ["parent"], activeRole: "parent", shopId: null, shopName: null, shopModule: null },
  { id: 85002,  username: "85002",     password: "parent", fullName: "Kate Wick",                role: "parent", allRoles: ["parent"], activeRole: "parent", shopId: null, shopName: null, shopModule: null },
  { id: 85003,  username: "85003",     password: "parent", fullName: "Brad Pitt",                role: "parent", allRoles: ["parent"], activeRole: "parent", shopId: null, shopName: null, shopModule: null },
  { id: 70652,  username: "70652",     password: "parent", fullName: "Kritsada SUWAN",           role: "parent", allRoles: ["parent"], activeRole: "parent", shopId: null, shopName: null, shopModule: null },
  { id: 70699,  username: "70699",     password: "parent", fullName: "Malee RAKDEE",             role: "parent", allRoles: ["parent"], activeRole: "parent", shopId: null, shopName: null, shopModule: null },
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

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return null;
      const parsed: AuthUser = JSON.parse(stored);
      // Backward compat: old sessions lack allRoles/activeRole
      if (!parsed.allRoles) parsed.allRoles = [parsed.role];
      if (!parsed.activeRole) parsed.activeRole = parsed.role;
      return parsed;
    } catch {
      return null;
    }
  });

  const isAuthenticated = user !== null;

  const login = async (
    username: string,
    password: string,
  ): Promise<{ success: boolean; error?: string }> => {
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
          (u) => u.username === username && u.password === password,
        );
        if (found) {
          const { password: _pw, ...authUser } = found;
          // Reset activeRole to primary on each fresh login
          authUser.activeRole = authUser.role;
          setUser(authUser);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
          console.warn(
            "[AuthContext] mock fallback — backend returned",
            res.status,
            "(prototype demo mode)",
          );
          return { success: true };
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
        const mockMatch = MOCK_USERS.find((u) => u.username === username);
        const resolvedRole: UserRole =
          backendRole ??
          mockMatch?.role ??
          (backendUser.is_superuser ? "admin" : "cashier");
        // Collect all roles from backend roles[] array
        const secondaryRoles: UserRole[] = (backendUser.roles ?? [])
          .map((r: { name: string }) => r.name as UserRole)
          .filter((r: UserRole) => r !== resolvedRole);
        const allRoles: UserRole[] = [...new Set([resolvedRole, ...secondaryRoles])];
        const shopId = backendUser.shop_id ?? mockMatch?.shopId ?? null;
        authUser = {
          id: backendUser.id,
          username: backendUser.username,
          fullName: backendUser.full_name ?? backendUser.username,
          role: resolvedRole,
          allRoles,
          activeRole: resolvedRole,
          shopId,
          shopName: mockMatch?.shopName ?? null,
          shopModule: mockMatch?.shopModule ?? moduleOf(shopId),
        };
        // Authoritative: fetch shop metadata to get .module from backend
        if (shopId) {
          try {
            const shopRes = await fetch(`${API_BASE_URL}/shops/${shopId}`, {
              headers: { Authorization: `Bearer ${data.access_token}` },
            });
            if (shopRes.ok) {
              const shop = await shopRes.json();
              authUser.shopModule = (shop.module as AppModule) ?? authUser.shopModule;
              authUser.shopName = shop.name ?? authUser.shopName;
            }
          } catch { /* keep inferred module */ }
        }
      } else {
        const mockMatch = MOCK_USERS.find((u) => u.username === username);
        authUser = mockMatch
          ? {
              id: mockMatch.id, username: mockMatch.username, fullName: mockMatch.fullName,
              role: mockMatch.role, allRoles: mockMatch.allRoles, activeRole: mockMatch.role,
              shopId: mockMatch.shopId, shopName: mockMatch.shopName, shopModule: mockMatch.shopModule,
            }
          : { id: 0, username, fullName: username, role: "cashier", allRoles: ["cashier"], activeRole: "cashier", shopId: null, shopName: null, shopModule: null };
      }

      setUser(authUser);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
      return { success: true };
    } catch {
      // Offline mock fallback (prototype demo) — backend unreachable
      const found = MOCK_USERS.find(
        (u) => u.username === username && u.password === password,
      );
      if (found) {
        const { password: _pw, ...authUser } = found;
        authUser.activeRole = authUser.role;
        setUser(authUser);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
        console.warn(
          "[AuthContext] offline mock fallback — backend unreachable (prototype demo mode)",
        );
        return { success: true };
      }
      return { success: false, error: "Cannot reach server. Please try again." };
    }
  };

  const loginWithMockSSO = async (
    email: string,
    fullName?: string,
  ): Promise<{ success: boolean; error?: string }> => {
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
      const allRoles: UserRole[] = [...new Set([resolvedRole, ...secondaryRoles])];
      const authUser: AuthUser = {
        id: backendUser.id,
        username: backendUser.username,
        fullName: backendUser.full_name ?? backendUser.username,
        role: resolvedRole,
        allRoles,
        activeRole: resolvedRole,
        shopId: null,
        shopName: null,
        shopModule: null,
      };
      setUser(authUser);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message ?? "SSO unavailable" };
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
    return roles.includes(user.activeRole ?? user.role);
  };

  const hasShopAccess = (shopId: ShopId): boolean =>
    user?.role === "admin" || user?.shopId === shopId;

  const setActiveRole = (role: UserRole) => {
    if (!user) return;
    const updated: AuthUser = { ...user, activeRole: role };
    setUser(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated, login, loginWithMockSSO, logout, hasRole, hasShopAccess, setActiveRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
