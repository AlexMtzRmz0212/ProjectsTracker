import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, PanelRight, X } from "lucide-react";
import { iconFor, inkText } from "../lib/palette";
import { useHeaderBottom } from "../hooks/useHeaderBottom";
import { useClickOutside } from "../hooks/useClickOutside";

const MIN_WIDTH = 352;
const DEFAULT_WIDTH = MIN_WIDTH; // it opens at its least width
const GAP = 40; // the strip of window always left beside it, where its tab sits
const SLIDE_MS = 260; // a little over the time it takes to slide away
const fitWidth = (w) => Math.round(Math.max(MIN_WIDTH, Math.min(w, window.innerWidth - GAP)));
// A press on a window open over the page (or the menus and pickers a row opens) is not a press "elsewhere"
const KEEP_WIDE = '[role="dialog"], [role="menu"]';

/**
 * A side peek: the project last clicked, in a panel off the right edge, under the header. The board
 * stays in reach beside it, so another project can be clicked straight into it. Where the window is wide
 * enough the page gives way to it (`onWidth` says how much it covers); otherwise it goes over the page. Its tab stays on
 * screen when it is away, to bring the same project back. The tab is also its handle: click it to
 * open or put away the peek, drag it to set how wide the peek is, or drag it most of the way to the right edge
 * to put it away. With the tab focused, the left and right arrow keys widen and narrow it. The peek is always
 * at its least width to begin with: a width pulled out lasts until a press lands elsewhere on the page, or
 * the peek is put away. `widthResetKey` going up brings it back to that width too. Esc puts it away too, except while a window is open
 * on top, while `escPaused`, and inside a text box (a sub-to-do uses it to cancel).
 */
export default function ProjectPeek({ open, onOpenChange, onWidth, widthResetKey = 0, project, escPaused = false, children }) {
  const panel = useRef(null);
  const top = useHeaderBottom();
  const id = useId();
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [dragW, setDragW] = useState(null); // the width the tab has been pulled to, while it is being dragged
  const drag = useRef(null);
  const dragged = useRef(false); // a drag must not also count as the tab's click

  const setAndSave = (w) => setWidth(fitWidth(w));

  // The tab sits on the panel's left edge, so the panel widens as it is pulled left. Pulled in from shut,
  // it starts from nothing; narrower than the least width it starts to slide away, and well short of it
  // it is let go shut, keeping the width it had.
  const tabDrag = {
    onPointerDown: (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const from = open ? panel.current.offsetWidth : 0;
      drag.current = { x0: e.clientX, from, w: from, moved: false };
      dragged.current = false;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x0;
      if (!d.moved && Math.abs(dx) < 5) return;
      if (!d.moved) document.body.style.cursor = "col-resize";
      d.moved = true;
      d.w = Math.min(d.from - dx, document.documentElement.clientWidth - GAP);
      setDragW(d.w);
    },
    onPointerUp: () => {
      const d = drag.current;
      drag.current = null;
      if (!d?.moved) return;
      dragged.current = true;
      document.body.style.cursor = "";
      setDragW(null);
      if (d.w < MIN_WIDTH / 2) return onOpenChange(false);
      setAndSave(d.w);
      onOpenChange(true);
    },
  };
  tabDrag.onPointerCancel = tabDrag.onPointerUp;

  const onTabKey = (e) => {
    if (!open) return;
    const step = e.shiftKey ? 96 : 32;
    if (e.key === "ArrowLeft") setAndSave(panel.current.offsetWidth + step);
    else if (e.key === "ArrowRight") setAndSave(panel.current.offsetWidth - step);
    else return;
    e.preventDefault();
  };

  // `widthResetKey` going up puts the peek back to its usual width (and keeps it open): the page asks for it when
  // the peek has left too little room for anything but the tabs
  const firstKey = useRef(widthResetKey);
  useEffect(() => {
    if (widthResetKey === firstKey.current) return;
    firstKey.current = widthResetKey;
    setWidth(fitWidth(DEFAULT_WIDTH));
  }, [widthResetKey]);

  // Back to the least width: when a press lands elsewhere on the page, and once the peek has slid away
  // (not before: it would visibly shrink on its way out)
  const wide = width > fitWidth(DEFAULT_WIDTH);
  useClickOutside(panel, open && wide && drag.current === null, () => setWidth(fitWidth(DEFAULT_WIDTH)), KEEP_WIDE);
  useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => setWidth(fitWidth(DEFAULT_WIDTH)), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [open]);

  const dragging = dragW !== null;
  const shownWidth = dragging ? fitWidth(dragW) : width;
  const transform = dragging ? `translateX(${Math.max(0, MIN_WIDTH - dragW)}px)` : open ? "translateX(0)" : "translateX(100%)";

  // How much of the window the panel covers, for the page to make room (`onWidth(px, dragging)`)
  const covered = dragging ? Math.max(0, Math.round(dragW)) : open ? width : 0;
  useEffect(() => {
    onWidth?.(covered, dragging);
  }, [covered, dragging, onWidth]);

  useEffect(() => {
    if (!open || escPaused) return;
    const onKey = (e) => {
      if (e.key !== "Escape" || document.querySelector('[role="dialog"], [role="menu"]')) return;
      if (e.target instanceof Element && e.target.closest("textarea, input")) return;
      onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, escPaused, onOpenChange]);

  const Icon = project ? iconFor(project.icon) : PanelRight;
  const name = project?.name ?? "Side peek";

  return createPortal(
    <aside
      ref={panel}
      aria-label={project ? `${project.name}, side peek` : "Side peek"}
      className="fixed bottom-[var(--bottom-bar,0px)] right-0 z-[35] flex flex-col border-l border-line-strong bg-surface [--row-bg:var(--surface)] transition-transform duration-200 ease-out"
      style={{ top, width: `min(${shownWidth}px, calc(100vw - ${GAP}px))`, transform, transition: dragging ? "none" : undefined }}
    >
      {/* The tab stays on screen when the panel is away, so there is always something to pull it in by */}
      <button
        {...tabDrag}
        onClick={() => {
          if (!dragged.current) onOpenChange(!open);
          dragged.current = false;
        }}
        onKeyDown={onTabKey}
        className={`absolute right-full top-12 flex w-7 cursor-col-resize touch-none flex-col items-center gap-1 border-y border-l border-line-strong py-2 transition-colors hover:text-text ${
          dragging ? "bg-surface-2 text-text" : "bg-surface text-muted"
        }`}
        aria-label={
          open ? `Close the side peek on ${name}. Drag, or use the left and right arrow keys, to resize it`
          : project ? `Peek at ${project.name}` : "Open the side peek"
        }
        title={open ? "Click to close, drag to resize" : project ? `Peek at ${project.name} (click, or drag out to a width)` : "Side peek: click a project to open it here"}
        aria-expanded={open}
        aria-controls={id}
      >
        <Icon size={15} style={project ? { color: inkText(project.color) } : undefined} aria-hidden="true" />
        <ChevronLeft size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      <div className="flex shrink-0 items-center gap-2 border-b-[3px] border-double border-line-strong py-3 pl-5 pr-3 sm:pl-6">
        <h2 className="min-w-0 flex-1 truncate font-serif text-lg font-semibold" title={name}>
          {name}
        </h2>
        <button
          onClick={() => onOpenChange(false)}
          className="grid size-9 shrink-0 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
          aria-label="Close the side peek"
          title="Close (Esc)"
        >
          <X size={18} />
        </button>
      </div>

      <div id={id} inert={!open} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-5 sm:px-6">
        {project ? (
          children
        ) : (
          <div className="grid flex-1 place-items-center border border-dashed border-line-strong p-6 text-center">
            <div>
              <PanelRight size={22} className="mx-auto text-faint" aria-hidden="true" />
              <p className="mt-3 font-serif text-lg font-semibold">Nothing to peek at yet</p>
              <p className="mt-1 text-[13px] text-muted">
                Click a project on the board, in the Feed or in Stats and it opens here, with the board still beside it.
              </p>
            </div>
          </div>
        )}
      </div>
    </aside>,
    document.body
  );
}
