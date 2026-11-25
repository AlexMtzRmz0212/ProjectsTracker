import { useCallback, useState } from "react";
import { scopedKey } from "../lib/storage";

const KEY = "pt-feed-tasks-pad";

function load(key) {
  try {
    // Nothing saved yet: pulled out, as the Tasks have always been in view
    return localStorage.getItem(key) !== "closed";
  } catch {
    return true;
  }
}

/**
 * Whether the Feed's Tasks pad is pulled out (the tasks show) or tucked away (only the projects show), kept in
 * this browser like the Feed's order. `setOpen(true | false)`.
 */
export function useTasksPad() {
  const key = scopedKey(KEY);
  const [open, setOpenState] = useState(() => load(key));

  const setOpen = useCallback(
    (value) => {
      setOpenState(value);
      try {
        localStorage.setItem(key, value ? "open" : "closed");
      } catch {
        // storage blocked: it lasts until the page is reloaded
      }
    },
    [key]
  );

  return { open, setOpen };
}
