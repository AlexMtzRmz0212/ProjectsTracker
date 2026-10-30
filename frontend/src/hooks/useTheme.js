import { useCallback, useSyncExternalStore } from "react";

// One shared store: the landing page has a toggle in its top bar and another in
// the demo's header, and they have to agree.
const listeners = new Set();
let current = document.documentElement.dataset.theme || "dark";

// Same colors as index.html's first-paint script: the browser bar, or an installed app's title bar
const BAR_COLORS = { light: "#f2ead4", dark: "#131a16" };

function setTheme(next) {
  current = next;
  document.documentElement.dataset.theme = next;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR_COLORS[next]);
  try {
    localStorage.setItem("pt-theme", next);
  } catch {
    // storage blocked: the theme still applies for this visit
  }
  listeners.forEach((l) => l());
}

const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, () => current);
  return [theme, useCallback(() => setTheme(current === "dark" ? "light" : "dark"), [])];
}
