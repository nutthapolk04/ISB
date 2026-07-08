export interface PricePanel {
    id: number;
    name: string;
    color: string | null;
}

export const panelColorClass: Record<string, string> = {
    blue: "bg-blue-100 text-blue-700 border-blue-300",
    green: "bg-green-100 text-green-700 border-green-300",
    orange: "bg-orange-100 text-orange-700 border-orange-300",
    red: "bg-red-100 text-red-700 border-red-300",
    purple: "bg-purple-100 text-purple-700 border-purple-300",
    gray: "bg-gray-100 text-gray-700 border-gray-300",
};

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
    price: number;
    internalPrice?: number;
    stock: number;
    category: string;
    subMerchantId: string;
    photoUrl?: string | null;
    color?: string | null;
    extraBarcodes?: ExtraBarcode[];
    // Bundle / Grade-Set fields (only present when isBundle=true)
    isBundle?: boolean;
    bundleId?: number;
}

export type DiscountMode = "amount" | "percent";

export interface CartItem extends Product {
    quantity: number;
    discountValue?: number;
    discountMode?: DiscountMode;
    priceOverride?: number | null;
}

export interface LastReceipt {
    receiptNumber: string;
    amount: number;
    remainingBalance?: number;
    studentName?: string;
    studentPhotoUrl?: string;
    studentGrade?: string;
}
