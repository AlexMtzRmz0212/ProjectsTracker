import { useCallback, useId, useLayoutEffect, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ellipsis, ListChecks, NotebookText, Pencil, Play, Plus, Square } from "lucide-react";
import { ON_INK, iconFor, inkFor, inkText, tint } from "../lib/palette";
import { fmtClock, fmtHM } from "../lib/time";
import { Button } from "./Modal";
import ArchiveDrawer from "./ArchiveDrawer";

/**
 * Every status as a column, every project as a card. Drag a card onto another column
 * to change its status, down onto the archive tab at the bottom of the screen to put it away, or up
 * to the trash can that drops in at the top to delete it. A mouse drags straight away; a
 * finger holds the card for a moment first, so columns still scroll. Phones show one
 * status at a time, and the chips on top take drops.
 *
 * `projects` are the ones on the board; `archived` are the ones in the archive drawer.
 */
export default function ProjectBoard({
  projects, archived, statuses, cardProps, onMove, onCreate, onDelete, onArchive, onRestore, onOpenArchived,
}) {
  const [phoneStatus, setPhoneStatus] = useState(null);
  const shownOnPhone = statuses.some((s) => s.id === phoneStatus) ? phoneStatus : statuses[0]?.id;
  const [hidden, toggleHidden] = useHiddenStatuses(statuses);

  // The trash can. `trashed` is the card last dropped in it; it outlives the question
  // so the slip keeps its words while it slides away.
  const [trashed, setTrashed] = useState(null); // { project, drop }
  const [asking, setAsking] = useState(false);
  const confirming = asking && projects.some((p) => p.id === trashed?.project.id);
  const closeTrash = useCallback(() => setAsking(false), []);

  const { root, drag, ghost, press, endSwallow } = useCardDrag({
    onPickUp: () => setAsking(false),
    onDrop: (id, target) => {
      const project = projects.find((p) => p.id === id);
      if (!project || !target) return false;
      if (target === "trash") {
        setTrashed((t) => ({ project, drop: (t?.drop ?? 0) + 1 }));
        setAsking(true);
        return true; // the ghost is swallowed by the can
      }
      if (target === "archive") {
        onArchive(project.id);
        return false; // the card is gone from its column at once, so there is nothing to animate
      }
      if (project.status_id !== target) onMove(project.id, target);
      return false;
    },
  });
  const dragId = drag?.phase === "drag" ? drag.id : null;
  const over = dragId !== null ? drag.target : null;
  const trashPhase = dragId !== null ? (over === "trash" ? "hot" : "ready") : confirming ? "confirm" : "hidden";
  const ghostProject = drag && projects.find((p) => p.id === drag.id);
  const statusesById = new Map(statuses.map((s) => [s.id, s]));

  return (
    <div ref={root} className="flex h-full min-h-[16rem] flex-col gap-3 pb-5">
      <TrashCan
        phase={trashPhase}
        project={trashed?.project}
        drop={trashed?.drop}
        totalSeconds={trashed ? cardProps(trashed.project).totalSeconds : 0}
        onCancel={closeTrash}
        onConfirm={() => {
          setAsking(false);
          onDelete(trashed.project.id);
        }}
      />

      {/* Phones: the status to look at, and where a dragged card is dropped */}
      <div className="flex shrink-0 flex-wrap gap-x-4 gap-y-0.5 md:hidden" role="radiogroup" aria-label="Status">
        {statuses.map((s) => {
          const active = s.id === shownOnPhone;
          const target = over === s.id;
          return (
            <button
              key={s.id}
              role="radio"
              aria-checked={active}
              data-drop={s.id}
              onClick={() => setPhoneStatus(s.id)}
              className={`inline-flex h-8 items-center gap-1.5 border-b-2 text-[13px] transition-colors ${
                active || target ? "text-text" : "border-transparent text-muted"
              } ${target ? "bg-surface-2 px-2" : ""}`}
              style={active || target ? { borderColor: inkText(inkFor(s.color)) } : undefined}
            >
              <span className="size-2 shrink-0" style={{ background: inkFor(s.color) }} aria-hidden="true" />
              {s.name}
              <span className="figures text-[11px] text-faint">{projects.filter((p) => p.status_id === s.id).length}</span>
            </button>
          );
        })}
      </div>

      {/* Larger screens: which statuses get a column. Phones already show one at a time. */}
      {statuses.length > 1 && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-0.5 max-md:hidden" role="group" aria-label="Show columns">
          <span className="font-serif text-xs italic text-faint">Show</span>
          {statuses.map((s) => {
            const shown = !hidden.has(s.id);
            const onlyOne = shown && statuses.length - hidden.size === 1;
            return (
              <button
                key={s.id}
                aria-pressed={shown}
                disabled={onlyOne}
                onClick={() => toggleHidden(s.id)}
                title={onlyOne ? "At least one column stays visible" : shown ? `Hide ${s.name}` : `Show ${s.name}`}
                className={`inline-flex h-7 items-center gap-1.5 border-b-2 text-[13px] transition-colors disabled:cursor-default ${
                  shown ? "text-text" : "border-transparent text-faint line-through hover:text-text"
                }`}
                style={shown ? { borderColor: inkText(inkFor(s.color)) } : undefined}
              >
                <span
                  className="size-2 shrink-0"
                  style={shown ? { background: inkFor(s.color) } : { boxShadow: `inset 0 0 0 1px ${inkFor(s.color)}` }}
                  aria-hidden="true"
                />
                {s.name}
                <span className="figures text-[11px] text-faint">{projects.filter((p) => p.status_id === s.id).length}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] gap-3 md:auto-cols-[minmax(15rem,1fr)] md:grid-flow-col md:grid-cols-none md:overflow-x-auto">
        {statuses.map((status) => {
          const cards = projects.filter((p) => p.status_id === status.id);
          return (
            <section
              key={status.id}
              aria-label={`${status.name}, ${cards.length} ${cards.length === 1 ? "project" : "projects"}`}
              data-drop={status.id}
              className={`min-h-0 flex-col border bg-surface-2/40 transition-colors ${
                status.id === shownOnPhone ? "flex" : "max-md:hidden"
              } ${hidden.has(status.id) ? "md:hidden" : "md:flex"} ${over === status.id ? "border-text bg-surface-2" : "border-line"}`}
            >
              <header className="flex shrink-0 items-center gap-2 border-b-[3px] border-double border-line-strong px-3 py-2">
                <span className="size-2.5 shrink-0" style={{ background: inkFor(status.color) }} aria-hidden="true" />
                <h3 className="min-w-0 truncate font-serif text-[15px] font-semibold">{status.name}</h3>
                <span className="figures text-xs text-muted">{cards.length}</span>
                {status.is_done && <span className="font-serif text-xs italic text-faint">finished</span>}
                <button
                  onClick={() => onCreate(status.id)}
                  aria-label={`New project in ${status.name}`}
                  title={`New project in ${status.name}`}
                  className="ml-auto grid size-7 shrink-0 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
                >
                  <Plus size={16} />
                </button>
              </header>

              <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                {cards.map((p) => (
                  <BoardCard
                    key={p.id}
                    project={p}
                    status={status}
                    dragging={drag?.id === p.id || (confirming && trashed.project.id === p.id)}
                    onPointerDown={(e) => press(e, p.id)}
                    {...cardProps(p)}
                  />
                ))}
                {cards.length === 0 && (
                  <li className="grid place-items-center border border-dashed border-line-strong px-3 py-6 text-center text-[13px] text-faint">
                    <span className="max-md:hidden">Drop a project here</span>
                    <span className="md:hidden">Nothing here</span>
                  </li>
                )}
              </ul>
            </section>
          );
        })}
      </div>

      <ArchiveDrawer
        projects={archived}
        statusesById={statusesById}
        dragging={dragId !== null}
        over={over === "archive"}
        onOpen={onOpenArchived}
        onRestore={onRestore}
      />

      {/* The card in your hand. Below the trash can, so the can stays visible under it. */}
      {ghostProject &&
        createPortal(
          <div
            ref={ghost}
            className={`drag-ghost ${drag.phase === "swallow" ? "is-swallowed" : ""}`}
            data-over={over ?? undefined}
            style={{ width: drag.width }}
            aria-hidden="true"
            inert
          >
            <ul
              className="drag-ghost-card"
              style={{ transformOrigin: `${drag.offsetX}px ${drag.offsetY}px` }}
              onAnimationEnd={(e) => e.animationName === "ghost-swallow" && endSwallow()}
            >
              <BoardCard
                project={ghostProject}
                status={statuses.find((s) => s.id === ghostProject.status_id) ?? statuses[0]}
                {...cardProps(ghostProject)}
              />
            </ul>
          </div>,
          document.body
        )}
    </div>
  );
}

const HIDDEN_KEY = "pt-hidden-statuses";

/** The statuses whose columns are switched off on larger screens, remembered per browser.
 *  Ids of deleted statuses are ignored, and the last visible column can't be hidden. */
function useHiddenStatuses(statuses) {
  const [stored, setStored] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(HIDDEN_KEY)) ?? [];
    } catch {
      return [];
    }
  });
  const hidden = new Set(stored.filter((id) => statuses.some((s) => s.id === id)));
  if (hidden.size >= statuses.length) hidden.clear();

  const toggle = (id) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else if (statuses.length - next.size > 1) next.add(id);
    setStored([...next]);
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
    } catch {
      // storage blocked: the choice still holds until the page is reloaded
    }
  };
  return [hidden, toggle];
}

const HOLD_MS = 350; // a finger has to rest this long on a card to pick it up
const MOUSE_SLOP = 5; // a mouse picks it up after moving this far, so clicks stay clicks
const TOUCH_SLOP = 8; // a finger that moves this far before the hold is scrolling

/**
 * Drag and drop on pointer events, so mice, fingers and pens all work. Drop targets are
 * elements with `data-drop` (a status id, "archive" or "trash"), found under the pointer as it
 * moves. `drag` is { id, phase: "drag" | "swallow", target, width, offsetX, offsetY }.
 * The ghost is moved straight through its ref, not through React, on every move.
 */
function useCardDrag({ onPickUp, onDrop }) {
  const root = useRef(null);
  const ghost = useRef(null);
  const live = useRef(null); // the press in progress
  const [drag, setDrag] = useState(null);
  const handlers = useRef({ onPickUp, onDrop });
  useLayoutEffect(() => {
    handlers.current = { onPickUp, onDrop };
  });

  const place = useCallback(() => {
    const s = live.current;
    if (s && ghost.current) ghost.current.style.transform = `translate(${s.x - s.offsetX}px, ${s.y - s.offsetY}px)`;
  }, []);

  // Put the ghost under the pointer as soon as it exists
  useLayoutEffect(() => {
    if (drag?.phase === "drag") place();
  }, [drag?.id, drag?.phase, place]);

  // Keep the page from scrolling under a finger that is carrying a card. It has to be
  // a non-passive listener, which React's onTouchMove isn't.
  useEffect(() => {
    const el = root.current;
    const hold = (e) => live.current?.active && e.cancelable && e.preventDefault();
    el.addEventListener("touchmove", hold, { passive: false });
    return () => el.removeEventListener("touchmove", hold);
  }, []);

  const release = useCallback(() => {
    const s = live.current;
    if (!s) return;
    clearTimeout(s.timer);
    s.detach();
    live.current = null;
    document.body.style.cursor = "";
  }, []);

  useEffect(() => release, [release]);

  const endSwallow = useCallback(() => setDrag((d) => (d?.phase === "swallow" ? null : d)), []);

  const press = (e, id) => {
    if (e.button !== 0 || live.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const s = {
      id,
      pointerId: e.pointerId,
      touch: e.pointerType !== "mouse",
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width,
      active: false,
      target: null,
    };

    const pickUp = () => {
      s.active = true;
      if (s.touch) navigator.vibrate?.(10);
      document.body.style.cursor = "grabbing";
      handlers.current.onPickUp();
      setDrag({ id, phase: "drag", target: null, width: s.width, offsetX: s.offsetX, offsetY: s.offsetY });
    };

    const onMove = (ev) => {
      if (ev.pointerId !== s.pointerId) return;
      s.x = ev.clientX;
      s.y = ev.clientY;
      if (!s.active) {
        const moved = Math.hypot(s.x - s.startX, s.y - s.startY);
        if (s.touch && moved > TOUCH_SLOP) release(); // scrolling, not dragging
        else if (!s.touch && moved > MOUSE_SLOP) pickUp();
        return;
      }
      place();
      const target = document.elementFromPoint(s.x, s.y)?.closest("[data-drop]")?.dataset.drop ?? null;
      if (target !== s.target) {
        s.target = target;
        setDrag((d) => d && { ...d, target });
      }
    };

    const onUp = (ev) => {
      if (ev.pointerId !== s.pointerId) return;
      const { active, target } = s;
      release();
      if (!active) return;
      // The pointer comes up over whatever was under the card; that isn't a click
      const swallowClick = (c) => {
        c.stopPropagation();
        c.preventDefault();
      };
      window.addEventListener("click", swallowClick, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallowClick, { capture: true }), 0);

      if (handlers.current.onDrop(id, target)) {
        const can = document.querySelector('[data-drop="trash"]')?.getBoundingClientRect();
        if (can && ghost.current) {
          ghost.current.style.setProperty("--to-x", `${can.left + can.width / 2 - s.x}px`);
          ghost.current.style.setProperty("--to-y", `${can.top + can.height / 2 - s.y}px`);
        }
        setDrag((d) => d && { ...d, phase: "swallow", target: null });
        setTimeout(endSwallow, 600); // in case the animation never runs (a hidden tab)
      } else {
        setDrag(null);
      }
    };

    const onCancel = (ev) => {
      if (ev.pointerId !== undefined && ev.pointerId !== s.pointerId) return;
      const wasActive = s.active;
      release();
      if (wasActive) setDrag(null);
    };
    const onKey = (ev) => ev.key === "Escape" && onCancel({});
    // A long press would otherwise open the browser's own menu
    const onContextMenu = (ev) => s.touch && ev.preventDefault();

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("contextmenu", onContextMenu);
    s.detach = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", onContextMenu);
    };
    if (s.touch) s.timer = setTimeout(pickUp, HOLD_MS);
    live.current = s;
  };

  return { root, drag, ghost, press, endSwallow };
}

function BoardCard({
  project, status, dragging, onPointerDown,
  totalSeconds, todaySeconds, lastSeven, openTodos, isRunning, elapsed,
  onOpen, onToggleTimer, onAddTime, onEdit,
}) {
  const { color, name } = project;
  const Icon = iconFor(project.icon);
  const finished = status.is_done;

  return (
    <li
      onPointerDown={onPointerDown}
      className={`cursor-grab select-none border border-l-[3px] bg-surface transition-opacity [-webkit-touch-callout:none] active:cursor-grabbing ${
        dragging ? "opacity-40" : ""
      } ${finished ? "border-line" : isRunning ? "" : "border-line"}`}
      // The sides are set one by one: a changing `borderColor` next to `borderLeftColor` makes React warn
      style={{
        borderLeftColor: color,
        ...(isRunning
          ? {
              backgroundColor: tint(color, 10),
              borderTopColor: tint(color, 55),
              borderRightColor: tint(color, 55),
              borderBottomColor: tint(color, 55),
            }
          : null),
      }}
    >
      <div className="flex items-start gap-2 px-3 pt-2.5">
        <Icon size={15} strokeWidth={2.25} className="mt-[3px] shrink-0" style={{ color: inkText(color) }} aria-hidden="true" />
        <button
          onClick={onOpen}
          title={name}
          aria-label={`Open ${name}: notes and to-dos`}
          className={`min-w-0 flex-1 text-left font-serif text-[15px] font-medium leading-snug underline-offset-4 hover:underline focus-visible:underline ${
            finished ? "text-muted" : ""
          }`}
        >
          <span className="line-clamp-2 break-words">{name}</span>
        </button>
        <CardMenu name={name} onAddTime={onAddTime} onEdit={onEdit} />
      </div>

      <div className="flex items-center gap-3 px-3 pt-1.5 text-xs text-muted">
        <span className="font-serif italic">Today</span>
        <span className={`figures -ml-2 ${todaySeconds ? "text-text" : ""}`}>{fmtHM(todaySeconds)}</span>
        <span className="font-serif italic">Total</span>
        <span className="figures -ml-2 text-text">{fmtHM(totalSeconds)}</span>
        {openTodos > 0 && (
          <span title={`${openTodos} open to-do${openTodos === 1 ? "" : "s"}`} className="inline-flex items-center gap-1">
            <ListChecks size={13} aria-hidden="true" />
            <span className="figures">{openTodos}</span>
            <span className="sr-only">open to-dos</span>
          </span>
        )}
        {project.notes && (
          <span title="Has notes" className="inline-flex">
            <NotebookText size={13} aria-hidden="true" />
            <span className="sr-only">Has notes</span>
          </span>
        )}
        <Sparkline className="ml-auto" days={lastSeven} color={color} />
      </div>

      <div className="px-3 pb-2.5 pt-2">
        {finished ? (
          <p className="font-serif text-xs italic text-faint">No timer on finished projects</p>
        ) : (
          <button
            onClick={onToggleTimer}
            className={`flex h-8 w-full items-center justify-center gap-1.5 border text-xs font-semibold transition-colors ${
              isRunning ? "" : "border-line-strong hover:border-text hover:bg-surface-2"
            }`}
            style={isRunning ? { background: color, borderColor: color, color: ON_INK } : undefined}
            aria-label={isRunning ? `Stop ${name}` : `Start ${name}`}
          >
            {isRunning ? (
              <>
                <Square size={10} fill="currentColor" />
                <span className="figures text-[13px]">{fmtClock(elapsed)}</span>
              </>
            ) : (
              <>
                <Play size={11} fill="currentColor" /> Start
              </>
            )}
          </button>
        )}
      </div>
    </li>
  );
}

/** Last seven days, today on the right. */
function Sparkline({ days, color, className = "" }) {
  const max = Math.max(...days.map((d) => d.secs), 1);
  return (
    <div className={`flex h-3.5 items-end gap-0.5 ${className}`} aria-hidden="true">
      {days.map((d, i) => (
        <div
          key={i}
          title={`${d.label}, ${fmtHM(d.secs)}`}
          className="w-1"
          style={{
            height: d.secs ? `${Math.max((d.secs / max) * 100, 18)}%` : "1px",
            background: d.secs ? (i === days.length - 1 ? color : tint(color, 50)) : "var(--faint)",
          }}
        />
      ))}
    </div>
  );
}

/** The ⋯ menu. It's drawn on top of the page, not inside the card, because the column
 *  scrolls and would otherwise clip it. */
function CardMenu({ name, onAddTime, onEdit }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const button = useRef(null);
  const menu = useRef(null);

  useLayoutEffect(() => {
    if (!open || !button.current || !menu.current) return;
    const b = button.current.getBoundingClientRect();
    const m = menu.current.getBoundingClientRect();
    const below = b.bottom + 4 + m.height <= window.innerHeight - 8;
    setPos({
      top: below ? b.bottom + 4 : Math.max(8, b.top - 4 - m.height),
      left: Math.min(Math.max(8, b.right - m.width), window.innerWidth - m.width - 8),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e) => !menu.current?.contains(e.target) && !button.current?.contains(e.target) && close();
    const onKey = (e) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, { capture: true });
    };
  }, [open]);

  const item = (Glyph, label, action) => (
    <button
      role="menuitem"
      onClick={() => {
        setOpen(false);
        action();
      }}
      className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-surface-2"
    >
      <Glyph size={15} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );

  return (
    <>
      <button
        ref={button}
        onClick={() => {
          setPos(null);
          setOpen((o) => !o);
        }}
        className="-mr-1.5 grid size-7 shrink-0 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
        aria-label={`Actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Ellipsis size={16} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            className="fade-in fixed z-[55] w-52 border border-line-strong bg-surface p-1"
            style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
          >
            {item(Plus, "Add time", onAddTime)}
            {item(Pencil, "Edit", onEdit)}
          </div>,
          document.body
        )}
    </>
  );
}

/** Drops in at the top of the screen while a card is dragged; dropping the card on it
 *  asks "Are you sure?" on a slip that unrolls out of the can. It stays mounted and
 *  `phase` (hidden | ready | hot | confirm) drives the motion, in index.css, both ways. */
function TrashCan({ phase, project, drop, totalSeconds, onCancel, onConfirm }) {
  const root = useRef(null);
  const id = useId();
  const confirming = phase === "confirm";
  const hidden = phase === "hidden";

  useEffect(() => {
    if (!confirming) return;
    const onDown = (e) => !root.current?.contains(e.target) && onCancel();
    const onKey = (e) => e.key === "Escape" && onCancel();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [confirming, onCancel]);

  const Icon = project ? iconFor(project.icon) : null;

  return createPortal(
    <div ref={root} className="trash" data-state={phase} inert={hidden} aria-hidden={hidden || undefined}>
      <div className="trash-can" data-drop="trash">
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <g className="trash-lid">
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </g>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        </svg>
        <span className="trash-caption">Drop to delete</span>
      </div>

      {project && (
        // Keyed on the drop, so each one unrolls a fresh slip with Delete focused
        <div
          key={drop}
          role="alertdialog"
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-note`}
          className="trash-slip w-80 border border-line-strong bg-surface"
        >
          <h2 id={`${id}-title`} className="border-b-[3px] border-double border-line-strong px-4 py-2.5 font-serif text-[15px] font-semibold">
            Are you sure?
          </h2>
          <div className="px-4 pt-3">
            <div className="flex items-center gap-2.5 border-b border-rule pb-3">
              <Icon size={17} className="shrink-0" style={{ color: inkText(project.color) }} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate font-serif text-[14px] font-medium">{project.name}</span>
              <span className="figures shrink-0 text-[13px] font-semibold text-danger">−{fmtHM(totalSeconds)} logged</span>
            </div>
            <p id={`${id}-note`} className="mt-2.5 text-xs text-muted">
              Its sessions and to-dos go with it. This can't be undone.
            </p>
          </div>
          <div className="flex items-center gap-2 px-4 py-3">
            <Button className="ml-auto" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="solidDanger" onClick={onConfirm} autoFocus={confirming}>
              Delete
            </Button>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
