import type { UserRole } from "@isb/shared";

/** String enum aligned with `@isb/shared` `UserRole`. */
export enum Role {
	Admin = "admin",
	Manager = "manager",
	Cashier = "cashier",
	Parent = "parent",
	Student = "student",
	Staff = "staff",
	Teacher = "teacher",
	Kitchen = "kitchen",
	CanteenOwner = "canteen_owner",
	RefundOfficer = "refund_officer",
	Kiosk = "kiosk",
	Finance = "finance",
}

export type { UserRole };

export const ALL_ROLES = Object.values(Role) as UserRole[];
