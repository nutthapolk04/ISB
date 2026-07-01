/**
 * Refund Family Lookup Service — read-only queries used by the pre-refund
 * verification UI on /refund. Lets a refund officer search the entire
 * customer + user dataset for a family before issuing a payout, then inspect
 * every member of that family (active, graduated, withdrawn, inactive) with a
 * read-only wallet snapshot.
 *
 * Read-only by design — no wallet rows are auto-created. We rely on a LEFT
 * JOIN so missing wallet rows surface as `wallet_id=null, wallet_balance=0`
 * instead of being filtered out.
 */
import { and, asc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { customers, users, wallets } from "@/db/schema";
import { pgNumber } from "@/lib/dates";

// ── DTOs (must match frontend/src/hooks/useRefundFamilyLookup.ts) ───────────

export interface FamilyMatchDTO {
    family_code: string;
    member_count: number;
    active_count: number;
    graduated_count: number;
    sample_names: string[];
}

export interface FamilySearchResponseDTO {
    query: string;
    items: FamilyMatchDTO[];
}

export interface FamilyMemberDetailDTO {
    entity_type: "user" | "customer";
    id: number;
    name: string;

    family_code: string | null;
    student_code: string | null;
    customer_code: string | null;
    username: string | null;
    external_id: string | null;

    email: string | null;
    phone: string | null;

    role: string | null;
    customer_type: string | null;
    school_type: string | null;
    grade: string | null;
    photo_url: string | null;

    card_uid: string | null;
    card_frozen: boolean;

    is_active: boolean;
    is_graduated: boolean;
    enroll_date: string | null;
    withdraw_date: string | null;

    wallet_id: number | null;
    wallet_balance: number;
}

export interface FamilyRosterResponseDTO {
    family_code: string;
    members: FamilyMemberDetailDTO[];
}

// ── Constants ──────────────────────────────────────────────────────────────

const MIN_QUERY_LEN = 2;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const SAMPLE_NAMES_PER_FAMILY = 4;

// ── Search ─────────────────────────────────────────────────────────────────

export async function searchRefundFamilies(
    rawQuery: string,
    limit = DEFAULT_LIMIT,
): Promise<FamilyMatchDTO[]> {
    const q = (rawQuery ?? "").trim();
    if (q.length < MIN_QUERY_LEN) return [];
    const lim = Math.max(1, Math.min(limit, MAX_LIMIT));
    const pattern = `%${q}%`;

    // Pull distinct candidate family_codes from both tables.
    const custCodeRows = await db
        .selectDistinct({ familyCode: customers.familyCode })
        .from(customers)
        .where(
            and(
                isNotNull(customers.familyCode),
                or(
                    ilike(customers.familyCode, pattern),
                    ilike(customers.name, pattern),
                    ilike(customers.studentCode, pattern),
                    ilike(customers.customerCode, pattern),
                    ilike(customers.cardUid, pattern),
                    ilike(customers.externalId, pattern),
                    ilike(customers.email, pattern),
                    ilike(customers.phone, pattern),
                ),
            ),
        );

    const userCodeRows = await db
        .selectDistinct({ familyCode: users.familyCode })
        .from(users)
        .where(
            and(
                isNotNull(users.familyCode),
                or(
                    ilike(users.familyCode, pattern),
                    ilike(users.username, pattern),
                    ilike(users.fullName, pattern),
                    ilike(users.email, pattern),
                    ilike(users.externalId, pattern),
                ),
            ),
        );

    const familyCodeSet = new Set<string>();
    for (const r of custCodeRows) if (r.familyCode) familyCodeSet.add(r.familyCode);
    for (const r of userCodeRows) if (r.familyCode) familyCodeSet.add(r.familyCode);
    if (familyCodeSet.size === 0) return [];

    // Cap aggregation scope — sort first to keep result deterministic when many
    // families match.
    const familyCodeList = Array.from(familyCodeSet).sort().slice(0, MAX_LIMIT * 2);

    const custRows = await db
        .select({
            familyCode: customers.familyCode,
            name: customers.name,
            isActive: customers.isActive,
            isGraduated: customers.isGraduated,
        })
        .from(customers)
        .where(inArray(customers.familyCode, familyCodeList));

    const userRows = await db
        .select({
            familyCode: users.familyCode,
            fullName: users.fullName,
            isActive: users.isActive,
        })
        .from(users)
        .where(inArray(users.familyCode, familyCodeList));

    type Slot = {
        member_count: number;
        active_count: number;
        graduated_count: number;
        sample_names: string[];
    };
    const agg = new Map<string, Slot>();
    const getSlot = (fc: string): Slot => {
        let slot = agg.get(fc);
        if (!slot) {
            slot = { member_count: 0, active_count: 0, graduated_count: 0, sample_names: [] };
            agg.set(fc, slot);
        }
        return slot;
    };

    for (const r of custRows) {
        if (!r.familyCode) continue;
        const slot = getSlot(r.familyCode);
        slot.member_count += 1;
        if (r.isActive) slot.active_count += 1;
        if (r.isGraduated) slot.graduated_count += 1;
        if (slot.sample_names.length < SAMPLE_NAMES_PER_FAMILY && r.name) {
            slot.sample_names.push(r.name);
        }
    }
    for (const r of userRows) {
        if (!r.familyCode) continue;
        const slot = getSlot(r.familyCode);
        slot.member_count += 1;
        if (r.isActive) slot.active_count += 1;
        if (slot.sample_names.length < SAMPLE_NAMES_PER_FAMILY && r.fullName) {
            slot.sample_names.push(r.fullName);
        }
    }

    const items: FamilyMatchDTO[] = Array.from(agg.entries()).map(([code, slot]) => ({
        family_code: code,
        member_count: slot.member_count,
        active_count: slot.active_count,
        graduated_count: slot.graduated_count,
        sample_names: slot.sample_names,
    }));
    items.sort(
        (a, b) =>
            b.member_count - a.member_count || a.family_code.localeCompare(b.family_code),
    );
    return items.slice(0, lim);
}

// ── Roster ─────────────────────────────────────────────────────────────────

export async function getRefundFamilyRoster(
    rawFamilyCode: string,
): Promise<FamilyRosterResponseDTO | null> {
    const familyCode = (rawFamilyCode ?? "").trim();
    if (!familyCode) return null;

    // LEFT JOIN wallet — members with no wallet still appear.
    const customerRows = await db
        .select({ c: customers, w: wallets })
        .from(customers)
        .leftJoin(wallets, eq(wallets.customerId, customers.id))
        .where(eq(customers.familyCode, familyCode))
        .orderBy(asc(customers.isGraduated), asc(customers.name));

    const userRows = await db
        .select({ u: users, w: wallets })
        .from(users)
        .leftJoin(wallets, eq(wallets.userId, users.id))
        .where(eq(users.familyCode, familyCode))
        .orderBy(asc(users.fullName));

    if (customerRows.length === 0 && userRows.length === 0) return null;

    const members: FamilyMemberDetailDTO[] = [];

    // Parents / staff first.
    for (const { u, w } of userRows) {
        members.push({
            entity_type: "user",
            id: u.id,
            name: u.fullName || u.username,
            family_code: u.familyCode,
            student_code: null,
            customer_code: null,
            username: u.username,
            external_id: u.externalId,
            email: u.email,
            phone: null,
            role: u.role,
            customer_type: u.customerType,
            school_type: null,
            grade: null,
            photo_url: u.photoUrl,
            card_uid: u.cardUid,
            card_frozen: false,
            is_active: u.isActive,
            is_graduated: false,
            enroll_date: null,
            withdraw_date: null,
            wallet_id: w?.id ?? null,
            wallet_balance: pgNumber(w?.balance ?? null) ?? 0,
        });
    }

    // Then students / customer-type members.
    for (const { c, w } of customerRows) {
        members.push({
            entity_type: "customer",
            id: c.id,
            name: c.name,
            family_code: c.familyCode,
            student_code: c.studentCode,
            customer_code: c.customerCode,
            username: null,
            external_id: c.externalId,
            email: c.email,
            phone: c.phone,
            role: c.customerKind === "student" ? "student" : null,
            customer_type: c.customerType,
            school_type: c.schoolType,
            grade: c.grade,
            photo_url: c.photoUrl,
            card_uid: c.cardUid,
            card_frozen: c.cardFrozen,
            is_active: c.isActive,
            is_graduated: c.isGraduated,
            enroll_date: c.enrollDate,
            withdraw_date: c.withdrawDate,
            wallet_id: w?.id ?? null,
            wallet_balance: pgNumber(w?.balance ?? null) ?? 0,
        });
    }

    return { family_code: familyCode, members };
}
