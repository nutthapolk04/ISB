import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./i18n";

// App is light-only — strip any stray .dark class (extensions / leftovers).
document.documentElement.classList.remove("dark");
document.documentElement.style.colorScheme = "light only";

// Recover a tab left open across a deploy: its index.html still points at
// asset hashes the server has replaced, so any lazy route/vendor chunk it
// hasn't loaded yet 404s and would otherwise dead-end on the ErrorBoundary.
// Reloading pulls a fresh index.html (served no-store) and the current bundle.
const RELOAD_GUARD_KEY = "chunk_reload_at";
window.addEventListener("vite:preloadError", (event) => {
    let last = 0;
    try {
        last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0);
    } catch {
        // Storage blocked (private mode / hardened browser) — treat as a first
        // failure. Worst case we reload once per occurrence, never in a loop,
        // because a reload that fixes the chunk stops the event from firing.
    }
    // Reload at most once a minute. Past that, return WITHOUT preventDefault so
    // the failure surfaces normally instead of the page silently reloading
    // forever against a deploy that is genuinely missing the file.
    if (Number.isFinite(last) && Date.now() - last < 60_000) return;
    try {
        sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    } catch { /* ignore — see above */ }
    event.preventDefault();
    window.location.reload();
});

createRoot(document.getElementById("root")!).render(<App />);
