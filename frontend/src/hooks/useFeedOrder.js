import { useCallback, useState } from "react";
import { DEFAULT_ORDER, FEED_MODES } from "../lib/feedOrder";

const modes = new Set(FEED_MODES.map((m) => m.id));
const ids = (value) => (Array.isArray(value) ? value.filter((x) => typeof x === "string") : []);

function load(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    return {
      mode: modes.has(saved?.mode) ? saved.mode : DEFAULT_ORDER.mode,
      manual: ids(saved?.manual),
      pinned: ids(saved?.pinned),
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
  const key = `pt-feed-order-${scope}`;
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
    (manual, released = []) => change((o) => ({ mode: "manual", manual, pinned: o.pinned.filter((x) => !released.includes(x)) })),
    [change]
  );

  return { ...order, setMode, togglePin, unpin, setManual };
}
