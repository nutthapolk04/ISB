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
  | "kiosk"
  | "finance"
  // ISB-synced visitor purchase card: no email, no login in ANY environment
  // (auth_service.ts rejects the role outright), tops up at kiosk or at a
  // Store shop with allow_topup, spends normally at POS.
  | "other";

export type ShopId = string;

export type AppModule = "canteen" | "store";

export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  role: UserRole;
  allRoles: UserRole[];
  activeRole: UserRole;
  shopId: ShopId | null;
  shopName: string | null;
  shopModule: AppModule | null;
}

export interface JWTPayload {
  sub: string;
  role: UserRole;
  shop_id?: ShopId | null;
  exp: number;
  iat?: number;
}
