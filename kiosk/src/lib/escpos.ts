/**
 * Client-side ESC/POS receipt builder for the 80mm kiosk printer (RMC800 family).
 *
 * Thai text on thermal printers via native code pages (TIS-620/CP874) is unreliable across
 * firmware revisions, so we render the whole receipt to a monochrome bitmap using the browser's
 * own Thai font and ship it as an ESC/POS raster image (`GS v 0`). The native plugin stays dumb:
 * it just writes the base64 payload we build here to the printer serial port.
 */

/** 80mm printers have ~72mm printable width = 576 dots at 8 dots/mm. Must be a multiple of 8. */
const PRINT_WIDTH = 576;
const BYTES_PER_ROW = PRINT_WIDTH / 8;
const MAX_HEIGHT = 2400;

/** A "monochrome threshold" — pixels darker than this become black dots. */
const LUMA_THRESHOLD = 160;

const FONT_STACK = `'Sarabun', 'Noto Sans Thai', 'Tahoma', 'Prompt', sans-serif`;

export interface ReceiptRow {
    label: string;
    value: string;
}

export interface ReceiptItem {
    /** Full display name (bake in quantity, e.g. "ข้าวผัด x2"). */
    name: string;
    priceText: string;
    addons?: string[];
}

export interface ReceiptData {
    schoolName?: string;
    /** Optional logo URL. Skipped automatically if it can't be read (e.g. CORS-tainted). */
    logoUrl?: string;
    title: string;
    typeLabel: string;
    rows: ReceiptRow[];
    /** Optional purchased-items section (canteen/store receipts). */
    itemsHeader?: string;
    items?: ReceiptItem[];
    /** Optional "balance before" line printed above the amount. */
    balanceBeforeLabel?: string;
    balanceBeforeText?: string;
    amountLabel: string;
    amountText: string;
    balanceLabel: string;
    balanceText: string;
    footerLines: string[];
}

/** @deprecated Kept for the top-up flow; use {@link ReceiptData}. */
export type TopupReceiptData = ReceiptData;

/** Load an image and return clean ImageData, or null if it can't be read (CORS taint, 404, ...). */
async function tryLoadLogo(url: string, maxW: number, maxH: number): Promise<HTMLCanvasElement | null> {
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.crossOrigin = 'anonymous';
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error('logo load failed'));
            el.src = url;
        });
        const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const cx = c.getContext('2d')!;
        cx.drawImage(img, 0, 0, w, h);
        // Probe: throws if the canvas is tainted. If so, we fall back to text-only.
        cx.getImageData(0, 0, 1, 1);
        return c;
    } catch {
        return null;
    }
}

/** Truncate text with an ellipsis so it fits within maxWidth at the current font. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) {
        t = t.slice(0, -1);
    }
    return t + '…';
}

/** Draw the receipt onto a canvas and return the used height. */
async function drawReceipt(ctx: CanvasRenderingContext2D, data: ReceiptData): Promise<number> {
    const cx = PRINT_WIDTH / 2;
    const marginX = 24;
    let y = 24;

    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';

    // Logo (optional)
    if (data.logoUrl) {
        const logo = await tryLoadLogo(data.logoUrl, 200, 120);
        if (logo) {
            ctx.drawImage(logo, cx - logo.width / 2, y);
            y += logo.height + 12;
        }
    }

    // School name
    if (data.schoolName) {
        ctx.textAlign = 'center';
        ctx.font = `bold 26px ${FONT_STACK}`;
        ctx.fillText(data.schoolName, cx, y);
        y += 36;
    }

    // Title
    ctx.textAlign = 'center';
    ctx.font = `bold 40px ${FONT_STACK}`;
    ctx.fillText(data.title, cx, y);
    y += 56;

    // Thick separator
    y = hr(ctx, marginX, y, 4);
    y += 10;

    // Detail rows
    ctx.font = `26px ${FONT_STACK}`;
    for (const row of data.rows) {
        ctx.textAlign = 'left';
        ctx.fillText(row.label, marginX, y);
        ctx.textAlign = 'right';
        ctx.font = `bold 26px ${FONT_STACK}`;
        ctx.fillText(row.value, PRINT_WIDTH - marginX, y);
        ctx.font = `26px ${FONT_STACK}`;
        y += 40;
    }

    // Purchased items (optional)
    if (data.items && data.items.length) {
        y += 6;
        y = dashed(ctx, marginX, y);
        y += 10;
        if (data.itemsHeader) {
            ctx.textAlign = 'left';
            ctx.font = `bold 22px ${FONT_STACK}`;
            ctx.fillText(data.itemsHeader, marginX, y);
            y += 32;
        }
        const priceReserve = 150;
        for (const item of data.items) {
            ctx.font = `24px ${FONT_STACK}`;
            ctx.textAlign = 'left';
            const name = fitText(ctx, item.name, PRINT_WIDTH - marginX * 2 - priceReserve);
            ctx.fillText(name, marginX, y);
            ctx.textAlign = 'right';
            ctx.font = `bold 24px ${FONT_STACK}`;
            ctx.fillText(item.priceText, PRINT_WIDTH - marginX, y);
            y += 34;
            if (item.addons && item.addons.length) {
                ctx.textAlign = 'left';
                ctx.font = `20px ${FONT_STACK}`;
                for (const addon of item.addons) {
                    ctx.fillText(`+ ${addon}`, marginX + 20, y);
                    y += 26;
                }
            }
        }
    }

    y += 6;
    y = dashed(ctx, marginX, y);
    y += 10;

    // Balance before (optional)
    if (data.balanceBeforeLabel && data.balanceBeforeText) {
        ctx.textAlign = 'left';
        ctx.font = `24px ${FONT_STACK}`;
        ctx.fillText(data.balanceBeforeLabel, marginX, y);
        ctx.textAlign = 'right';
        ctx.font = `bold 24px ${FONT_STACK}`;
        ctx.fillText(data.balanceBeforeText, PRINT_WIDTH - marginX, y);
        y += 40;
    }

    // Amount
    ctx.textAlign = 'left';
    ctx.font = `28px ${FONT_STACK}`;
    ctx.fillText(data.amountLabel, marginX, y);
    ctx.textAlign = 'right';
    ctx.font = `bold 34px ${FONT_STACK}`;
    ctx.fillText(data.amountText, PRINT_WIDTH - marginX, y - 4);
    y += 48;

    y = dashed(ctx, marginX, y);
    y += 14;

    // Balance after — centered, large
    ctx.textAlign = 'center';
    ctx.font = `24px ${FONT_STACK}`;
    ctx.fillText(data.balanceLabel, cx, y);
    y += 34;
    ctx.font = `bold 52px ${FONT_STACK}`;
    ctx.fillText(data.balanceText, cx, y);
    y += 66;

    y = hr(ctx, marginX, y, 4);
    y += 20;

    // Footer
    ctx.textAlign = 'center';
    ctx.font = `22px ${FONT_STACK}`;
    for (const line of data.footerLines) {
        ctx.fillText(line, cx, y);
        y += 30;
    }

    return Math.min(y + 8, MAX_HEIGHT);
}

function hr(ctx: CanvasRenderingContext2D, marginX: number, y: number, thickness: number): number {
    ctx.fillRect(marginX, y, PRINT_WIDTH - marginX * 2, thickness);
    return y + thickness;
}

function dashed(ctx: CanvasRenderingContext2D, marginX: number, y: number): number {
    const dash = 8;
    const gap = 6;
    for (let x = marginX; x < PRINT_WIDTH - marginX; x += dash + gap) {
        ctx.fillRect(x, y, dash, 2);
    }
    return y + 2;
}

/** Pack the drawn region into an ESC/POS `GS v 0` raster block (MSB-first, 1 = black dot). */
function toRaster(ctx: CanvasRenderingContext2D, height: number): Uint8Array {
    const { data } = ctx.getImageData(0, 0, PRINT_WIDTH, height);
    const body = new Uint8Array(BYTES_PER_ROW * height);
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < PRINT_WIDTH; col++) {
            const i = (row * PRINT_WIDTH + col) * 4;
            const a = data[i + 3];
            const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            // Transparent pixels are treated as white (paper).
            const black = a > 32 && luma < LUMA_THRESHOLD;
            if (black) {
                body[row * BYTES_PER_ROW + (col >> 3)] |= 0x80 >> (col & 7);
            }
        }
    }

    const header = new Uint8Array([
        0x1d, 0x76, 0x30, 0x00, // GS v 0 m=0
        BYTES_PER_ROW & 0xff, (BYTES_PER_ROW >> 8) & 0xff, // xL xH
        height & 0xff, (height >> 8) & 0xff, // yL yH
    ]);

    const out = new Uint8Array(header.length + body.length);
    out.set(header, 0);
    out.set(body, header.length);
    return out;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
    }
    return out;
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

/**
 * Render a receipt to a base64-encoded ESC/POS payload ready for `Hardware.printRaw`.
 */
export async function buildReceipt(data: ReceiptData): Promise<string> {
    const canvas = document.createElement('canvas');
    canvas.width = PRINT_WIDTH;
    canvas.height = MAX_HEIGHT;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, PRINT_WIDTH, MAX_HEIGHT);

    const height = await drawReceipt(ctx, data);
    const raster = toRaster(ctx, height);

    const INIT = new Uint8Array([0x1b, 0x40]); // ESC @  (reset)
    const ALIGN_LEFT = new Uint8Array([0x1b, 0x61, 0x00]);
    const FEED = new Uint8Array([0x1b, 0x64, 0x04]); // ESC d 4  (feed 4 lines)
    const CUT = new Uint8Array([0x1d, 0x56, 0x42, 0x00]); // GS V 66 0  (feed + partial cut)

    const payload = concatBytes([INIT, ALIGN_LEFT, raster, FEED, CUT]);
    return bytesToBase64(payload);
}

/** @deprecated Use {@link buildReceipt}. */
export const buildTopupReceipt = buildReceipt;
