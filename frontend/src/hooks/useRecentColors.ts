import { useState } from "react";

const MAX = 6;

function storageKey(shopId: string) {
  return `pos_recent_colors_${shopId}`;
}

function readStored(shopId: string): string[] {
  try { return JSON.parse(localStorage.getItem(storageKey(shopId)) ?? "[]"); }
  catch { return []; }
}

export function useRecentColors(shopId: string) {
  const [recentColors, setRecentColors] = useState<string[]>(() => readStored(shopId));

  const addRecentColor = (color: string) => {
    setRecentColors((prev) => {
      const next = [color, ...prev.filter((c) => c !== color)].slice(0, MAX);
      localStorage.setItem(storageKey(shopId), JSON.stringify(next));
      return next;
    });
  };

  return { recentColors, addRecentColor };
}
