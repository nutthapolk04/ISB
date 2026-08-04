/**
 * POS RFID / campus-card lookup helpers — shared by Canteen, Store, and
 * RfidPaymentModal. Tries card_uid format variants (hex, reversed hex, decimal,
 * zero-padded 10-digit decimal) before giving up.
 */
import { api, ApiError } from "@/lib/api";
import { cardUidLookupAttempts } from "@/lib/cardUid";
import type {
    DepartmentLookupResult,
    StudentLookupResult,
    UserPayerLookup,
} from "@/pages/canteen/RfidPaymentModal";

async function getByCardWithUidFallback<T>(pathPrefix: string, raw: string): Promise<T | null> {
    for (const attempt of cardUidLookupAttempts(raw)) {
        try {
            return await api.get<T>(`${pathPrefix}/${encodeURIComponent(attempt)}`);
        } catch (e) {
            if (e instanceof ApiError && e.status === 404) continue;
            throw e;
        }
    }
    return null;
}

export function departmentToStudentLookup(d: DepartmentLookupResult): StudentLookupResult {
    return {
        id: d.id,
        name: d.department_name,
        customer_code: d.department_code,
        student_code: d.department_code,
        department_code: d.department_code,
        customer_kind: "department",
        wallet_balance: d.wallet_balance ?? 0,
        wallet_id: d.wallet_id ?? null,
    };
}

export function userToStudentLookup(u: UserPayerLookup): StudentLookupResult {
    return {
        id: u.user_id,
        name: u.full_name,
        photo_url: u.photo_url ?? null,
        customer_code: u.username,
        role: u.role,
        staff_type: u.staff_type,
        external_id: u.external_id,
        wallet_balance: u.wallet_balance,
        wallet_id: u.wallet_id,
        customer_kind: u.role,
        user_id: u.user_id,
    };
}

export async function lookupCustomerByCard(raw: string): Promise<StudentLookupResult | null> {
    return getByCardWithUidFallback<StudentLookupResult>("/customers/by-card", raw);
}

export async function lookupUserByCard(raw: string): Promise<UserPayerLookup | null> {
    return getByCardWithUidFallback<UserPayerLookup>("/users/by-card", raw);
}

export async function lookupDepartmentByCard(raw: string): Promise<DepartmentLookupResult | null> {
    return getByCardWithUidFallback<DepartmentLookupResult>("/departments/by-card", raw);
}

/** Card-UID chain for passive background scans (customer → user → department). */
export async function lookupPosMemberByCardScan(raw: string): Promise<StudentLookupResult | null> {
    const customer = await lookupCustomerByCard(raw);
    if (customer) return customer;

    const user = await lookupUserByCard(raw);
    if (user) return userToStudentLookup(user);

    const dept = await lookupDepartmentByCard(raw);
    if (dept) return departmentToStudentLookup(dept);

    return null;
}

async function getOnce<T>(path: string): Promise<T | null> {
    try {
        return await api.get<T>(path);
    } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
    }
}

export type PosMemberLookupResult =
    | { kind: "customer"; student: StudentLookupResult }
    | { kind: "user"; user: UserPayerLookup }
    | { kind: "department"; department: DepartmentLookupResult };

/**
 * Full identity lookup for RfidPaymentModal — card UID chain with format
 * fallbacks, then typed code / username fallbacks (no UID expansion).
 */
export async function lookupPosMemberFull(raw: string): Promise<PosMemberLookupResult | null> {
    const q = raw.trim();
    if (!q) return null;

    const customer = await lookupCustomerByCard(q);
    if (customer) return { kind: "customer", student: customer };

    const user = await lookupUserByCard(q);
    if (user) return { kind: "user", user };

    const byCode = await getOnce<StudentLookupResult>(`/customers/by-code/${encodeURIComponent(q)}`);
    if (byCode) return { kind: "customer", student: byCode };

    const byExternal = await getOnce<UserPayerLookup>(`/users/by-external-id/${encodeURIComponent(q)}`);
    if (byExternal) return { kind: "user", user: byExternal };

    const deptByCard = await lookupDepartmentByCard(q);
    if (deptByCard) return { kind: "department", department: deptByCard };

    const depts = await getOnce<DepartmentLookupResult[]>(
        `/departments/?q=${encodeURIComponent(q)}&active_only=false`,
    );
    const exactDept = depts?.find((d) => d.department_code.toLowerCase() === q.toLowerCase());
    if (exactDept) return { kind: "department", department: exactDept };

    return null;
}

/** Passive scan with optional username fallback (canteen/store background RFID). */
export async function lookupPosMemberPassive(
    raw: string,
    opts?: { tryUsername?: boolean },
): Promise<StudentLookupResult | null> {
    const q = raw.trim();
    if (!q || q.length < 3) return null;

    const byCard = await lookupPosMemberByCardScan(q);
    if (byCard) return byCard;

    const byCode = await getOnce<StudentLookupResult>(`/customers/by-code/${encodeURIComponent(q)}`);
    if (byCode) return byCode;

    if (opts?.tryUsername) {
        const byUsername = await getOnce<UserPayerLookup>(`/users/by-username/${encodeURIComponent(q)}`);
        if (byUsername) return userToStudentLookup(byUsername);
    }

    return null;
}
