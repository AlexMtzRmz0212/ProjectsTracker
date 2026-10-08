import { useEffect, useRef, useState } from "react";

const SETTLE_MS = 160; // how long the held row takes to slide into its slot once let go
const EDGE = 40; // px from the top or bottom of a scrolling list where holding a row scrolls it
const INDENT = 28; // px a held row is pulled sideways before that means "under the row above" or "back out"

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

/**
 * Rearrange a list of rows by dragging a handle on each. The rows slide out of the way as the held
 * one passes them, and `onReorder` gets every id in the new order once it has settled.
 *
 * Each row is an element carrying `rowProps(index)` (it marks the row, and moves it while a drag is
 * on), and its handle a button carrying `gripProps(id, index)`. Rows may differ in height. Handles
 * also take the up and down arrow keys. Give the list's scrolling parent a `data-scroll` attribute
 * and holding a row near its top or bottom edge scrolls it.
 *
 * Rows can also be nested, with `nesting`: pull the held row to the right and it goes under the row
 * just above where it is held (`onNest(id, parentId)`, if `canNest(id, parentId)` allows it; that row,
 * `nestInto`, is marked while it would); pull it to the left and it goes back out (`onOutdent(id)`).
 * The right and left arrow keys on a handle do the same with the row above and the row itself.
 */
export function useReorder(ids, onReorder, nesting = {}) {
  const [drag, setDrag] = useState(null); // { id, from, to, dx, dy, heights, intent, settling }
  const live = useRef(null); // the drag in progress: its geometry, the pointer, the scroll
  const latest = useRef({ ids, onReorder, nesting });
  latest.current = { ids, onReorder, nesting };

  // A row dragged when its list goes away must not leave a timer or a frame behind
  useEffect(
    () => () => {
      cancelAnimationFrame(live.current?.raf);
      clearTimeout(live.current?.timer);
    },
    []
  );

  /** Where the held row is, and the slot it would drop into, from the pointer and the scroll. */
  const measure = () => {
    const g = live.current;
    if (!g || g.settling) return;
    const { from, tops, heights } = g;
    const total = tops[tops.length - 1] + heights[heights.length - 1];
    const scrolled = g.scroller ? g.scroller.scrollTop - g.startScroll : 0;
    const dy = clamp(g.y - g.startY + scrolled, -tops[from], total - tops[from] - heights[from]);
    // A row is passed once the held row's leading edge crosses its middle
    const top = tops[from] + dy;
    const bottom = top + heights[from];
    let to = from;
    for (let j = 0; j < from; j++) {
      if (top < tops[j] + heights[j] / 2) {
        to = j;
        break;
      }
    }
    for (let j = heights.length - 1; j > from; j--) {
      if (bottom > tops[j] + heights[j] / 2) {
        to = j;
        break;
      }
    }
    g.to = to;
    // Pulled sideways: under the row above the slot it is over, or back out
    const { ids: now, nesting: n } = latest.current;
    const dx = g.x - g.startX;
    let intent = null;
    if (dx > INDENT && n.onNest) {
      const above = now.filter((x) => x !== g.id)[to - 1];
      if (above !== undefined && (!n.canNest || n.canNest(g.id, above))) intent = { kind: "nest", parent: above };
    } else if (dx < -INDENT && n.onOutdent) {
      intent = { kind: "out" };
    }
    g.intent = intent;
    const hx = clamp(dx, n.onOutdent ? -INDENT * 1.5 : 0, n.onNest ? INDENT * 1.5 : 0);
    setDrag((d) => d && !d.settling && { ...d, dy, dx: hx, to, intent });
  };

  const tick = () => {
    const g = live.current;
    if (!g || g.settling) return;
    const r = g.scroller.getBoundingClientRect();
    const speed = g.y < r.top + EDGE ? g.y - (r.top + EDGE) : g.y > r.bottom - EDGE ? g.y - (r.bottom - EDGE) : 0;
    const before = g.scroller.scrollTop;
    if (speed) g.scroller.scrollTop += clamp(speed / 4, -14, 14);
    if (g.scroller.scrollTop !== before) measure();
    g.raf = requestAnimationFrame(tick);
  };

  const gripDown = (e, id, from) => {
    if (e.button !== 0 || live.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const row = e.currentTarget.closest("[data-sort]");
    const rows = [...row.parentElement.children].filter((c) => c.hasAttribute("data-sort"));
    const heights = rows.map((r) => r.offsetHeight);
    const tops = heights.map((_, i) => heights.slice(0, i).reduce((a, b) => a + b, 0));
    const scroller = row.closest("[data-scroll]");
    live.current = {
      id, from, to: from, heights, tops, scroller, settling: false, intent: null,
      startX: e.clientX, x: e.clientX, startY: e.clientY, y: e.clientY, startScroll: scroller?.scrollTop ?? 0,
    };
    setDrag({ id, from, to: from, dx: 0, dy: 0, heights, intent: null, settling: false });
    if (scroller) live.current.raf = requestAnimationFrame(tick);
  };

  const gripMove = (e) => {
    const g = live.current;
    if (!g || g.settling) return;
    g.x = e.clientX;
    g.y = e.clientY;
    measure();
  };

  const gripUp = (commit) => {
    const g = live.current;
    if (!g || g.settling) return;
    g.settling = true;
    cancelAnimationFrame(g.raf);
    // Nesting (or moving back out) puts the row somewhere else: it settles where it was and is moved then
    const intent = commit ? g.intent : null;
    const to = commit && !intent ? g.to : g.from;
    // The held row ends level with the slot: as far as the rows it passes are tall
    const between = to > g.from ? g.heights.slice(g.from + 1, to + 1) : g.heights.slice(to, g.from);
    const dy = (to > g.from ? 1 : -1) * between.reduce((a, b) => a + b, 0);
    setDrag((d) => d && { ...d, to, dx: 0, dy, intent: null, settling: true });
    g.timer = setTimeout(() => {
      const n = latest.current.nesting;
      if (intent?.kind === "nest") n.onNest(g.id, intent.parent);
      else if (intent?.kind === "out") n.onOutdent(g.id);
      else if (to !== g.from) {
        const next = [...latest.current.ids];
        next.splice(to, 0, next.splice(g.from, 1)[0]);
        latest.current.onReorder(next);
      }
      live.current = null;
      setDrag(null);
    }, SETTLE_MS);
  };

  const gripKey = (e, i) => {
    const { ids: all, nesting: n } = latest.current;
    if (e.key === "ArrowRight" && n.onNest && i > 0 && (!n.canNest || n.canNest(all[i], all[i - 1]))) {
      e.preventDefault();
      return n.onNest(all[i], all[i - 1]);
    }
    if (e.key === "ArrowLeft" && n.onOutdent) {
      e.preventDefault();
      return n.onOutdent(all[i]);
    }
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const j = i + (e.key === "ArrowUp" ? -1 : 1);
    const { ids: now } = latest.current;
    if (j < 0 || j >= now.length) return;
    const next = [...now];
    [next[i], next[j]] = [next[j], next[i]];
    latest.current.onReorder(next);
  };

  return {
    /** The id of the row being held, or null. */
    held: drag?.id ?? null,
    /** The row the held one would go under, while it is pulled right over it. */
    nestInto: drag?.intent?.kind === "nest" ? drag.intent.parent : null,
    /** The held row would go back out, while it is pulled left. */
    outdenting: drag?.intent?.kind === "out",
    rowProps: (i) => {
      if (!drag) return { "data-sort": "" };
      const { from, to, dx = 0, dy, heights, settling } = drag;
      const shift =
        i === from ? dy
        : from < to && i > from && i <= to ? -heights[from]
        : from > to && i >= to && i < from ? heights[from]
        : 0;
      return {
        "data-sort": "",
        className: `relative transition-transform ease-out ${i === from ? "z-10 bg-surface shadow-[0_6px_18px_-6px_rgba(0,0,0,0.45)]" : ""}`,
        style: {
          transform: i === from ? `translate(${dx}px, ${shift}px)` : `translateY(${shift}px)`,
          transitionDuration: i === from && !settling ? "0ms" : `${SETTLE_MS}ms`,
        },
      };
    },
    gripProps: (id, i) => ({
      onPointerDown: (e) => gripDown(e, id, i),
      onPointerMove: gripMove,
      onPointerUp: () => gripUp(true),
      onPointerCancel: () => gripUp(false),
      onKeyDown: (e) => gripKey(e, i),
    }),
  };
}
