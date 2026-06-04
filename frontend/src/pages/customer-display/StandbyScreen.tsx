/**
 * Standby screen — shown between transactions on the customer-facing
 * second monitor. Rotates admin-uploaded images every 5 seconds. Falls
 * back to a clean ISB-branded placeholder when no images are uploaded yet.
 */
import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";

import { api } from "@/lib/api";
import { API_BASE_URL } from "@/lib/constants";

interface DisplayImage {
  id: number;
  content_type: string;
  size_bytes: number;
  sort_order: number;
}

const ROTATION_MS = 5000;

export function StandbyScreen() {
  const [images, setImages] = useState<DisplayImage[]>([]);
  const [index, setIndex] = useState(0);

  // Load the rotation once; admin uploads while the page is open won't
  // hot-reload until the next page refresh, which is fine — the standby
  // window stays open for hours at a time and the admin will refresh it
  // after changing the rotation.
  useEffect(() => {
    let cancelled = false;
    // Diagnostic logging — the customer-display window has no UI for errors,
    // so we surface state transitions to the console for troubleshooting
    // (cashier can press F12 → Console if the rotation looks wrong).
    console.log("[CustomerDisplay] Fetching rotation images…");
    api
      .get<DisplayImage[]>("/customer-display/images")
      .then((data) => {
        console.log("[CustomerDisplay] Got", data?.length ?? 0, "images:", data);
        if (!cancelled) setImages(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        console.error("[CustomerDisplay] Failed to load images:", err);
        /* render placeholder */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Rotation timer — pauses by virtue of resetting whenever the image list
  // changes (e.g. first load).
  useEffect(() => {
    if (images.length <= 1) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % images.length);
    }, ROTATION_MS);
    return () => window.clearInterval(id);
  }, [images.length]);

  if (images.length === 0) {
    // No images uploaded yet — show a clean branded placeholder rather
    // than a black void so the cashier knows the display is alive.
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-gradient-to-br from-amber-50 via-white to-orange-50 text-zinc-800">
        <Monitor className="h-20 w-20 text-amber-400 mb-6" strokeWidth={1.5} />
        <h1 className="text-4xl font-bold tracking-tight">Welcome</h1>
        <p className="mt-3 text-base text-zinc-500">
          International School Bangkok
        </p>
      </div>
    );
  }

  const current = images[index];
  return (
    <div className="h-screen w-screen relative overflow-hidden bg-black">
      <img
        key={current.id}
        src={`${API_BASE_URL}/customer-display/images/${current.id}/binary`}
        alt=""
        className="absolute inset-0 h-full w-full object-cover animate-fade-in"
      />
      {/* Subtle dot indicator — bottom center, only when >1 image */}
      {images.length > 1 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2">
          {images.map((img, i) => (
            <span
              key={img.id}
              className={
                "h-1.5 rounded-full transition-all duration-300 " +
                (i === index ? "w-8 bg-white" : "w-1.5 bg-white/40")
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
