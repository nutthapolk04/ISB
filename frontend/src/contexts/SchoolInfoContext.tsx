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
}

const DEFAULT: SchoolInfo = {
  name: "ISB",
  address: "",
  taxId: "",
  phone: "",
  logoUrl: "",
  coverUrl: "",
};

const SchoolInfoContext = createContext<SchoolInfo>(DEFAULT);

export function SchoolInfoProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<SchoolInfo>(DEFAULT);

  useEffect(() => {
    api.get<Record<string, string>>("/admin/settings/school")
      .then((d) => {
        setInfo({
          name:     d.school_name     || DEFAULT.name,
          address:  d.school_address  || "",
          taxId:    d.school_tax_id   || "",
          phone:    d.school_phone    || "",
          logoUrl:  d.school_logo_url  || "",
          coverUrl: d.school_cover_url || "",
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
