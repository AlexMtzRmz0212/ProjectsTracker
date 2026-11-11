import { useEffect, useRef } from "react";

/**
 * Calls `onOutside` when a press lands outside the element in `ref` while `active`. Presses inside any of
 * the `ignore` selectors (a trigger button that lives elsewhere, say) don't count. The latest callback is
 * used without re-attaching the listener.
 */
export function useClickOutside(ref, active, onOutside, ignore) {
  const latest = useRef(onOutside);
  useEffect(() => {
    latest.current = onOutside;
  });

  useEffect(() => {
    if (!active) return;
    const onDown = (e) => {
      const el = ref.current;
      if (!el || el.contains(e.target)) return;
      if (ignore && e.target instanceof Element && e.target.closest(ignore)) return;
      latest.current();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [ref, active, ignore]);
}
