/**
 * SchoolInfoContext — fetches school settings once at app load and shares them
 * globally. Consumers use the `useSchoolInfo()` hook.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";

export interface SchoolInfo {
  name: string;
  address: string;
  taxId: string;
  phone: string;
  logoUrl: string;
  coverUrl: string;
  /** Optional footer line printed at the bottom of every receipt. Admin
   *  configures via System Settings; empty string means fall back to the
   *  localized "Thank you" default in the receipt template. */
  receiptFooter: string;
}

const DEFAULT: SchoolInfo = {
  name: "ISB",
  address: "",
  taxId: "",
  phone: "",
  logoUrl: "",
  coverUrl: "",
  receiptFooter: "",
};

const SchoolInfoContext = createContext<SchoolInfo>(DEFAULT);

export function SchoolInfoProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<SchoolInfo>(DEFAULT);

  useEffect(() => {
    // Try the full admin endpoint first (admin role); fall back to the
    // public endpoint (no auth) so managers/cashiers still see the correct
    // school name and logo even though they can't access /school.
    api.get<Record<string, string>>("/admin/settings/school")
      .catch(() => api.get<Record<string, string>>("/admin/settings/public"))
      .then((d) => {
        setInfo({
          name:          d.school_name           || DEFAULT.name,
          address:       d.school_address        || "",
          taxId:         d.school_tax_id         || "",
          phone:         d.school_phone          || "",
          logoUrl:       d.school_logo_url       || "",
          coverUrl:      d.school_cover_url      || "",
          receiptFooter: d.school_receipt_footer || "",
        });
      })
      .catch(() => {}); // silent — fall back to defaults
  }, []);

  return (
    <SchoolInfoContext.Provider value={info}>
      {children}
    </SchoolInfoContext.Provider>
  );
}

export function useSchoolInfo(): SchoolInfo {
  return useContext(SchoolInfoContext);
}
