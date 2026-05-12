import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

export interface UnitOfMeasure {
  id: number;
  code: string;
  name: string;
  name_en: string | null;
  base_uom_id: number | null;
  conversion_factor: number;
  is_active: boolean;
  base_uom_code: string | null;
  base_uom_name: string | null;
}

export function useUom() {
  const [uoms, setUoms] = useState<UnitOfMeasure[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUoms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<UnitOfMeasure[]>("/uom/");
      setUoms(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch UOMs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUoms();
  }, [fetchUoms]);

  const seedDefaults = useCallback(async () => {
    try {
      await api.post("/uom/seed-defaults", {});
      await fetchUoms();
    } catch (e) {
      throw e;
    }
  }, [fetchUoms]);

  return { uoms, loading, error, refetch: fetchUoms, seedDefaults };
}
