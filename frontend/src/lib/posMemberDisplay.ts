import type { StudentLookupResult } from "@/pages/canteen/RfidPaymentModal";

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Short label for staff_type values synced from HR. */
export function formatStaffType(staffType: string): string {
    if (staffType === "Classified Staff") return "Classified";
    if (staffType === "Certified Staff") return "Certified";
    return staffType;
}

function studentIdLine(
    m: Pick<StudentLookupResult, "external_id" | "student_code" | "customer_code">,
    isbCardPrefix: boolean,
): string {
    if (m.external_id) {
        return isbCardPrefix ? `ISBCard: ${m.external_id}` : m.external_id;
    }
    return m.student_code ?? m.customer_code;
}

/**
 * Subtitle under the member name in POS cart / member-search panels.
 * - Department → department_code
 * - Staff user → role + staff_type
 * - Other users → external_id + role
 * - Student/customer → external_id (or code) + grade
 */
export function memberSubtitleLine(
    m: StudentLookupResult,
    opts?: { isbCardPrefix?: boolean },
): string {
    const isbCardPrefix = opts?.isbCardPrefix ?? false;

    if (m.customer_kind === "department") {
        return m.department_code ?? m.customer_code;
    }

    const role = m.role ?? m.customer_kind ?? "";

    if (m.user_id != null) {
        if (role === "staff") {
            const parts: string[] = [];
            if (m.external_id) parts.push(m.external_id);
            parts.push("Staff");
            if (m.staff_type) parts.push(formatStaffType(m.staff_type));
            return parts.join(" · ");
        }
        const parts: string[] = [];
        if (m.external_id) parts.push(m.external_id);
        if (role) parts.push(capitalize(role));
        return parts.join(" · ");
    }



    const parts = [studentIdLine(m, isbCardPrefix)];
    if (m.grade) parts.push(`Grade ${m.grade}`);
    return parts.join(" · ");
}
