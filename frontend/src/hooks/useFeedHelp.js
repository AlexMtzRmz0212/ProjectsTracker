import { useCallback, useState } from "react";
import { scopedKey } from "../lib/storage";

const KEY = "pt-feed-help";

function load(key) {
  try {
    // Nothing saved yet: the descriptions are tucked away until asked for
    return localStorage.getItem(key) === "open";
  } catch {
    return false;
  }
}

/** Whether the descriptions under the Feed's order and cadence controls are showing, kept in this browser. */
export function useFeedHelp() {
  const key = scopedKey(KEY);
  const [open, setOpenState] = useState(() => load(key));

  const toggle = useCallback(
    () =>
      setOpenState((prev) => {
        try {
          localStorage.setItem(key, prev ? "closed" : "open");
        } catch {
          // storage blocked: it lasts until the page is reloaded
        }
        return !prev;
      }),
    [key]
  );

  return { open, toggle };
}
