import { useLayoutEffect, useState } from "react";

/** Where the app header ends (px from the top of the window), found by its data-app-header, for a layer
 *  that starts under it so the timers up there stay in reach. The demo's header sits partway down a
 *  page, hence measuring it. 0 while `enabled` is off. */
export function useHeaderBottom(enabled = true) {
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    if (!enabled) return;
    const measure = () => setTop(Math.max(0, document.querySelector("[data-app-header]")?.getBoundingClientRect().bottom ?? 0));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [enabled]);
  return top;
}
