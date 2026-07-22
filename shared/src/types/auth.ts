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
  | "finance";

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
