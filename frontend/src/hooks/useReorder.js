import { useEffect, useRef, useState } from "react";

const SETTLE_MS = 160; // how long the held row takes to slide into its slot once let go
const EDGE = 40; // px from the top or bottom of a scrolling list where holding a row scrolls it

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

/**
 * Rearrange a list of rows by dragging a handle on each. The rows slide out of the way as the held
 * one passes them, and `onReorder` gets every id in the new order once it has settled.
 *
 * Each row is an element carrying `rowProps(index)` (it marks the row, and moves it while a drag is
 * on), and its handle a button carrying `gripProps(id, index)`. Rows may differ in height. Handles
 * also take the up and down arrow keys. Give the list's scrolling parent a `data-scroll` attribute
 * and holding a row near its top or bottom edge scrolls it.
 */
export function useReorder(ids, onReorder) {
  const [drag, setDrag] = useState(null); // { id, from, to, dy, heights, settling }
  const live = useRef(null); // the drag in progress: its geometry, the pointer, the scroll
  const latest = useRef({ ids, onReorder });
  latest.current = { ids, onReorder };

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
    setDrag((d) => d && !d.settling && { ...d, dy, to });
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
      from, to: from, heights, tops, scroller, settling: false,
      startY: e.clientY, y: e.clientY, startScroll: scroller?.scrollTop ?? 0,
    };
    setDrag({ id, from, to: from, dy: 0, heights, settling: false });
    if (scroller) live.current.raf = requestAnimationFrame(tick);
  };

  const gripMove = (e) => {
    const g = live.current;
    if (!g || g.settling) return;
    g.y = e.clientY;
    measure();
  };

  const gripUp = (commit) => {
    const g = live.current;
    if (!g || g.settling) return;
    g.settling = true;
    cancelAnimationFrame(g.raf);
    const to = commit ? g.to : g.from;
    // The held row ends level with the slot: as far as the rows it passes are tall
    const between = to > g.from ? g.heights.slice(g.from + 1, to + 1) : g.heights.slice(to, g.from);
    const dy = (to > g.from ? 1 : -1) * between.reduce((a, b) => a + b, 0);
    setDrag((d) => d && { ...d, to, dy, settling: true });
    g.timer = setTimeout(() => {
      if (to !== g.from) {
        const next = [...latest.current.ids];
        next.splice(to, 0, next.splice(g.from, 1)[0]);
        latest.current.onReorder(next);
      }
      live.current = null;
      setDrag(null);
    }, SETTLE_MS);
  };

  const gripKey = (e, i) => {
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
    rowProps: (i) => {
      if (!drag) return { "data-sort": "" };
      const { from, to, dy, heights, settling } = drag;
      const shift =
        i === from ? dy
        : from < to && i > from && i <= to ? -heights[from]
        : from > to && i >= to && i < from ? heights[from]
        : 0;
      return {
        "data-sort": "",
        className: `relative transition-transform ease-out ${i === from ? "z-10 bg-surface shadow-[0_6px_18px_-6px_rgba(0,0,0,0.45)]" : ""}`,
        style: {
          transform: `translateY(${shift}px)`,
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
