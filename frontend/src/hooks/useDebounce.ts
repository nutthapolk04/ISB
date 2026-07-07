import { useEffect, useState } from "react";

/**
 * Returns `value`, updated only after it stops changing for `delayMs`.
 * Use in a dependency array to debounce a search/fetch effect.
 */
export function useDebounce<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
