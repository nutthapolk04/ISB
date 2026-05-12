/**
 * Shared types for canteen menu option groups + options.
 * Mirrors backend schemas at app/schemas/shop.py (MenuOptionGroupResponse etc).
 */

export type OptionSelectionType = "single" | "multi" | "quantity";

export interface MenuOption {
  id: number;
  name: string;
  price_delta: number;
  sort_order: number;
}

export interface MenuOptionGroup {
  id: number;
  product_id: number;
  name: string;
  selection_type: OptionSelectionType;
  is_required: boolean;
  max_selections: number | null;
  sort_order: number;
  options: MenuOption[];
}

/** Snapshot shape persisted on receipt_items.options. */
export interface ReceiptOptionsSnapshot {
  groups: Array<{
    group_id: number;
    name: string;
    selection_type: OptionSelectionType;
    options: Array<{
      option_id: number;
      name: string;
      price_delta: number;
      quantity: number;
    }>;
  }>;
  options_total: number;
}

/** Cart-time selection state, grouped for render. */
export interface SelectedOptionGroup {
  groupId: number;
  groupName: string;
  selectionType: OptionSelectionType;
  options: Array<{
    id: number;
    name: string;
    priceDelta: number;
    quantity: number;
  }>;
}
