import { useRef, useState } from "react";

/**
 * Dragging a panel that lives off an edge of the screen (`side`: "right", or "top" for one that drops
 * down) by a handle (its tab, its title bar). The panel follows the pointer and settles open or shut
 * when let go. `offset` is how far (px) the panel is pushed toward its edge from fully open while a drag
 * is under way, null otherwise. `handlers` go on each handle; `wasDrag()` tells a handle's click apart
 * from the end of a drag that started on it.
 */
export function useEdgeDrag(panel, open, onOpenChange, side = "right") {
  const drag = useRef(null);
  const dragged = useRef(false); // a drag that started on a button must not also count as its click
  const [offset, setOffset] = useState(null);

  const top = side === "top";
  // Where the pointer is along the way the panel goes away: right for a side panel, up for a top one
  const along = (e) => (top ? -e.clientY : e.clientX);
  const clampOffset = (d, dx) => Math.min(d.width, Math.max(0, d.from + dx));

  const onPointerDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.currentTarget.tagName !== "BUTTON" && e.target.closest("button")) return; // the title bar's own buttons
    const width = top ? panel.current.offsetHeight : panel.current.offsetWidth;
    drag.current = { x0: along(e), last: along(e), dir: 0, from: open ? 0 : width, width, moved: false };
    dragged.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const at = along(e);
    const dx = at - d.x0;
    if (!d.moved && Math.abs(dx) < 5) return;
    d.moved = true;
    if (at !== d.last) d.dir = Math.sign(at - d.last);
    d.last = at;
    setOffset(clampOffset(d, dx));
  };

  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    dragged.current = true;
    const at = clampOffset(d, along(e) - d.x0);
    // Past either end of the middle band it goes where it already is; in the band, where it was heading
    const band = d.width * 0.2;
    const next = Math.abs(at - d.width / 2) > band ? at < d.width / 2 : d.dir < 0;
    setOffset(null);
    onOpenChange(next);
  };

  const wasDrag = () => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  };

  return {
    offset,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
    wasDrag,
    style: {
      transform: top
        ? offset !== null ? `translateY(${-offset}px)` : open ? "translateY(0)" : "translateY(-100%)"
        : offset !== null ? `translateX(${offset}px)` : open ? "translateX(0)" : "translateX(100%)",
      transition: offset !== null ? "none" : undefined,
    },
  };
}
