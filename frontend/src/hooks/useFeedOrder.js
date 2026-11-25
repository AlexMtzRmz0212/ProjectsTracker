import { useCallback, useState } from "react";
import { DEFAULT_ORDER, FEED_MODES, TASKS_PLACES } from "../lib/feedOrder";
import { scopedKey } from "../lib/storage";

const modes = new Set(FEED_MODES.map((m) => m.id));
const places = new Set(TASKS_PLACES.map((p) => p.id));
const ids = (value) => (Array.isArray(value) ? value.filter((x) => typeof x === "string") : []);
// Orders that are gone: "recent" was renamed, "tasks first" and "projects first" are now the Tasks card setting
const RETIRED = { recent: { mode: "newest" }, tasks: { mode: "rotation", tasks: "top" }, projects: { mode: "rotation", tasks: "bottom" }, edited: { mode: "rotation" } };

function load(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    const kept = RETIRED[saved?.mode] ?? {};
    const mode = kept.mode ?? saved?.mode;
    const tasks = saved?.tasks ?? kept.tasks;
    return {
      mode: modes.has(mode) ? mode : DEFAULT_ORDER.mode,
      manual: ids(saved?.manual),
      pinned: ids(saved?.pinned),
      displace: saved?.displace === true,
      // Nothing saved yet: the default. Someone who picked another rotation keeps it.
      hide: typeof saved?.hide === "boolean" ? saved.hide : DEFAULT_ORDER.hide,
      tasks: places.has(tasks) ? tasks : DEFAULT_ORDER.tasks,
    };
  } catch {
    return DEFAULT_ORDER;
  }
}

/**
 * How the Feed is ordered, kept in this browser (like the Tasks card's skip): the mode, the saved order for
 * "My order", and the pinned cards (the first of them is the top card). `scope` keeps the demo apart from the app.
 */
export function useFeedOrder(scope) {
  const key = scopedKey(`pt-feed-order-${scope}`);
  const [order, setOrder] = useState(() => load(key));

  const change = useCallback(
    (fn) =>
      setOrder((prev) => {
        const next = fn(prev);
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // storage blocked: it lasts until the page is reloaded
        }
        return next;
      }),
    [key]
  );

  const setMode = useCallback((mode) => change((o) => ({ ...o, mode })), [change]);
  /** Pin a card to the top (the newest pin goes first), or take its pin off. */
  const togglePin = useCallback(
    (id) => change((o) => ({ ...o, pinned: o.pinned.includes(id) ? o.pinned.filter((x) => x !== id) : [id, ...o.pinned] })),
    [change]
  );
  const unpin = useCallback((id) => change((o) => (o.pinned.includes(id) ? { ...o, pinned: o.pinned.filter((x) => x !== id) } : o)), [change]);
  /** Save an order (card ids, first on top) and switch to it. Cards in `released` lose their pin, so they land where put. */
  const setManual = useCallback(
    (manual, released = []) => change((o) => ({ ...o, mode: "manual", manual, pinned: o.pinned.filter((x) => !released.includes(x)) })),
    [change]
  );
  /** How the rotation counts each project's "done every N days": "direct" (straight by rotation), "days" (ordered by when
   *  each is due again) or "hide" (kept out of the Feed until it is due). */
  const setRotation = useCallback((value) => change((o) => ({ ...o, displace: value === "days", hide: value === "hide" })), [change]);

  /** Where the Tasks card goes: "mixed", "top" or "bottom". */
  const setTasks = useCallback((tasks) => change((o) => ({ ...o, tasks })), [change]);

  return { ...order, setMode, togglePin, unpin, setManual, setRotation, setTasks };
}
