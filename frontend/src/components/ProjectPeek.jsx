import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, PanelRight, X } from "lucide-react";
import { iconFor, inkText } from "../lib/palette";
import { useHeaderBottom } from "../hooks/useHeaderBottom";

const WIDTH_KEY = "pt-peek-width";
const DEFAULT_WIDTH = 576;
const MIN_WIDTH = 352;
const GAP = 40; // the strip of window always left beside it, where its tab sits
const fitWidth = (w) => Math.round(Math.max(MIN_WIDTH, Math.min(w, window.innerWidth - GAP)));

function readWidth() {
  try {
    return Number(localStorage.getItem(WIDTH_KEY)) || DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function saveWidth(w) {
  try {
    localStorage.setItem(WIDTH_KEY, String(w));
  } catch {
    // storage blocked: it just won't survive a reload
  }
}

/**
 * A side peek: the project last clicked, in a panel off the right edge, under the header. The board
 * stays in reach beside it, so another project can be clicked straight into it. Its tab stays on
 * screen when it is away, to bring the same project back. The tab is also its handle: click it to
 * open or put away the peek, drag it to set how wide the peek is (that width is remembered in this
 * browser), or drag it most of the way to the right edge to put it away. With the tab focused, the
 * left and right arrow keys widen and narrow it. Esc puts it away too, except while a window is open
 * on top, while `escPaused`, and inside a text box (a sub-to-do uses it to cancel).
 */
export default function ProjectPeek({ open, onOpenChange, project, escPaused = false, children }) {
  const panel = useRef(null);
  const top = useHeaderBottom();
  const id = useId();
  const [width, setWidth] = useState(readWidth);
  const [dragW, setDragW] = useState(null); // the width the tab has been pulled to, while it is being dragged
  const drag = useRef(null);
  const dragged = useRef(false); // a drag must not also count as the tab's click

  const setAndSave = (w) => {
    const next = fitWidth(w);
    setWidth(next);
    saveWidth(next);
  };

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

  const dragging = dragW !== null;
  const shownWidth = dragging ? fitWidth(dragW) : width;
  const transform = dragging ? `translateX(${Math.max(0, MIN_WIDTH - dragW)}px)` : open ? "translateX(0)" : "translateX(100%)";

  useEffect(() => {
    if (!open || escPaused) return;
    const onKey = (e) => {
      if (e.key !== "Escape" || document.querySelector('[role="dialog"]')) return;
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
      className="fixed bottom-0 right-0 z-[35] flex flex-col border-l border-line-strong bg-surface transition-transform duration-200 ease-out"
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
