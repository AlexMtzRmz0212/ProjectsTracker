import { useCallback, useSyncExternalStore } from "react";

// One shared store: the landing page has a toggle in its top bar and another in
// the demo's header, and they have to agree.
const listeners = new Set();
let current = document.documentElement.dataset.theme || "dark";

function setTheme(next) {
  current = next;
  document.documentElement.dataset.theme = next;
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
