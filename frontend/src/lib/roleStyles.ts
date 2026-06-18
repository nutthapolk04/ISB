import type { CSSProperties } from "react";

/**
 * Role-based gradient styles — single source of truth.
 * parent → purple, staff → teal, student → orange, fallback → teal.
 * Matches FamilyDashboard.tsx card colors.
 */
export const ROLE_STYLES: Record<string, CSSProperties> = {
  parent: { background: "linear-gradient(135deg, #3b1f7e 0%, #6b3fa0 50%, #9b6fcf 100%)" },
  staff:  { background: "linear-gradient(135deg, #0f766e 0%, #0d9488 50%, #2dd4bf 100%)" },
  student:{ background: "linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #b45309 100%)" },
  admin:  { background: "linear-gradient(135deg, #0f766e 0%, #0d9488 50%, #2dd4bf 100%)" },
};

export const getRoleStyle = (role: string | null | undefined): CSSProperties =>
  ROLE_STYLES[role || ""] ?? ROLE_STYLES.staff;

export const getRoleLabel = (role: string | null | undefined): string => {
  switch (role) {
    case "student":  return "Student";
    case "staff":    return "Staff";
    case "admin":    return "Admin";
    case "manager":  return "Manager";
    case "cashier":  return "Cashier";
    case "kitchen":  return "Kitchen";
    case "parent":   return "Parent / Guardian";
    default:         return "Parent / Guardian";
  }
};
