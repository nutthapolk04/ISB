export interface SubMerchant {
  id: string;
  name: string;
}

export interface ExtraBarcode {
  id: number;
  barcode: string;
  label: string | null;
}

export interface Product {
  id: number;
  productCode: string;
  barcode: string;
  name: string;
  category: string;
  subMerchantId: string;
  externalPrice: number;
  internalPrice: number;
  vatPercent: number;
  avgCost: number;
  stock: number;
  minStock: number;
  color?: string | null;

  extraBarcodes?: ExtraBarcode[];
}

export type MovementType = "receive" | "sale" | "adjustment" | "internal_use" | "void" | "exchange";

export interface StockMovement {
  id: number;
  date: string;
  productId: number;
  productName: string;
  type: MovementType;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  costPerUnit?: number;
  reference?: string;
  department?: string;
  note?: string;
  reversesId?: number | null;
  reversedById?: number | null;
}

export interface BatchItem {
  uid: string;
  productId: string;
  qty: string;
  cost: string;
  po: string;
  invoice: string;
  note: string;
  /** "YYYY-MM-DD" when the goods arrived. Optional on the type so a queue
   *  persisted by an older build still parses; the hook falls back to today. */
  receivedDate?: string;
}

export interface Category {
  id: string;
  name: string;
}

export const SUB_MERCHANTS: SubMerchant[] = [
  { id: "coop",      name: "Coop Shop"   },
  { id: "sports",    name: "Sports Shop" },
  { id: "canteen",   name: "ISB Canteen" },
  { id: "bookstore", name: "Bookstore"   },
];
