/**
 * Canteen product imagery & category styling.
 *
 * ShopProduct has no `image_url` column in the current schema, so we map
 * `product_code` → Unsplash food photo URLs here. Falls back to a lucide
 * icon + category gradient when a product_code isn't in the map.
 */
import type { LucideIcon } from "lucide-react";
import { Soup, Pizza, CupSoda, Cookie, Cake, UtensilsCrossed } from "lucide-react";

export type CanteenCategoryKey =
  | "Thai"
  | "Western"
  | "Drinks"
  | "Snacks"
  | "Desserts";

/** Unsplash stable photo URLs (crop + compress via query params). */
const u = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=480&h=480&q=70`;

export const CANTEEN_IMAGE_BY_CODE: Record<string, string> = {
  // Thai
  "CT-THAI-01": u("photo-1559314809-0d155014e29e"), // pad thai
  "CT-THAI-02": u("photo-1512058564366-18510be2db19"), // fried rice
  "CT-THAI-03": u("photo-1552611052-33e04de081de"), // tom yum noodles
  "CT-THAI-04": u("photo-1455619452474-d2be8b1e70cd"), // green curry
  // Western
  "CT-WEST-01": u("photo-1513104890138-7c749659a591"), // pizza slice
  "CT-WEST-02": u("photo-1568901346375-23c9450c58cd"), // cheeseburger
  "CT-WEST-03": u("photo-1626700051175-6818013e1d4f"), // caesar wrap
  "CT-WEST-04": u("photo-1621996346565-e3dbc646d9a9"), // spaghetti
  // Drinks
  "CT-DRNK-01": u("photo-1613478223719-2ab802602423"), // orange juice
  "CT-DRNK-02": u("photo-1558857563-b371033873b8"), // thai milk tea
  "CT-DRNK-03": u("photo-1517701604599-bb29b565090c"), // iced latte
  "CT-DRNK-04": u("photo-1523371683702-8b1ced8a5d68"), // sparkling water
  // Snacks
  "CT-SNCK-01": u("photo-1541592106381-b31e9677c0e5"), // fries
  "CT-SNCK-02": u("photo-1562967916-eb82221dfb92"), // nuggets
  "CT-SNCK-03": u("photo-1544601638-eaaef5757741"), // spring rolls
  "CT-SNCK-04": u("photo-1490474418585-ba9bad8fd0ea"), // fruit cup
  // Desserts
  "CT-DSRT-01": u("photo-1711161897027-3cfc2a3fa4f0"), // mango sticky rice
  "CT-DSRT-02": u("photo-1606313564200-e75d5e30476c"), // brownie
  "CT-DSRT-03": u("photo-1501443762994-82bd5dace89a"), // ice cream cup
  "CT-DSRT-04": u("photo-1488900128323-21503983a07e"), // coconut jelly
};

export const CANTEEN_CATEGORY_FALLBACK: Record<
  CanteenCategoryKey,
  { Icon: LucideIcon; gradient: string }
> = {
  Thai:     { Icon: Soup,             gradient: "from-orange-200 to-amber-300" },
  Western:  { Icon: Pizza,            gradient: "from-amber-200 to-yellow-300" },
  Drinks:   { Icon: CupSoda,          gradient: "from-sky-200 to-cyan-300" },
  Snacks:   { Icon: Cookie,           gradient: "from-yellow-200 to-orange-300" },
  Desserts: { Icon: Cake,             gradient: "from-pink-200 to-rose-300" },
};

export const CANTEEN_CATEGORIES: CanteenCategoryKey[] = [
  "Thai",
  "Western",
  "Drinks",
  "Snacks",
  "Desserts",
];

export function getCanteenImage(productCode: string): string | null {
  return CANTEEN_IMAGE_BY_CODE[productCode] ?? null;
}

export function getCanteenFallback(category: string) {
  return (
    CANTEEN_CATEGORY_FALLBACK[category as CanteenCategoryKey] ?? {
      Icon: UtensilsCrossed,
      gradient: "from-stone-200 to-stone-300",
    }
  );
}
