import { useLayoutEffect, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ellipsis, ListChecks, NotebookText, Pencil, Play, Plus, Square, Trash2, Check } from "lucide-react";
import { ON_INK, iconFor, inkFor, inkText, tint } from "../lib/palette";
import { fmtClock, fmtHM } from "../lib/time";

/**
 * Every status as a column, every project as a card. Drag a card onto another column
 * to change its status. Drag and drop needs a mouse, so each card's menu also has
 * "Move to", and on phones one status is shown at a time (chosen from the chips on top).
 */
export default function ProjectBoard({ projects, statuses, cardProps, onMove, onCreate }) {
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [phoneStatus, setPhoneStatus] = useState(null);
  const shownOnPhone = statuses.some((s) => s.id === phoneStatus) ? phoneStatus : statuses[0]?.id;

  const drop = (event, statusId) => {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain") || dragId;
    const project = projects.find((p) => p.id === id);
    setDragId(null);
    setOverId(null);
    if (project && project.status_id !== statusId) onMove(project.id, statusId);
  };

  return (
    <div className="flex h-full min-h-[16rem] flex-col gap-3">
      {/* Phones: the status to look at */}
      <div className="flex shrink-0 flex-wrap gap-x-4 gap-y-0.5 md:hidden" role="radiogroup" aria-label="Status">
        {statuses.map((s) => {
          const active = s.id === shownOnPhone;
          return (
            <button
              key={s.id}
              role="radio"
              aria-checked={active}
              onClick={() => setPhoneStatus(s.id)}
              className={`inline-flex h-8 items-center gap-1.5 border-b-2 text-[13px] transition-colors ${
                active ? "text-text" : "border-transparent text-muted"
              }`}
              style={active ? { borderColor: inkText(inkFor(s.color)) } : undefined}
            >
              <span className="size-2 shrink-0" style={{ background: inkFor(s.color) }} aria-hidden="true" />
              {s.name}
              <span className="figures text-[11px] text-faint">{projects.filter((p) => p.status_id === s.id).length}</span>
            </button>
          );
        })}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] gap-3 md:auto-cols-[minmax(15rem,1fr)] md:grid-flow-col md:grid-cols-none md:overflow-x-auto">
        {statuses.map((status) => {
          const cards = projects.filter((p) => p.status_id === status.id);
          const over = overId === status.id && dragId !== null;
          return (
            <section
              key={status.id}
              aria-label={`${status.name}, ${cards.length} ${cards.length === 1 ? "project" : "projects"}`}
              onDragOver={(e) => {
                if (dragId === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overId !== status.id) setOverId(status.id);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setOverId(null);
              }}
              onDrop={(e) => drop(e, status.id)}
              className={`min-h-0 flex-col border bg-surface-2/40 transition-colors ${
                status.id === shownOnPhone ? "flex" : "max-md:hidden"
              } md:flex ${over ? "border-text bg-surface-2" : "border-line"}`}
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
                    statuses={statuses}
                    dragging={dragId === p.id}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", p.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(p.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverId(null);
                    }}
                    onMove={(statusId) => onMove(p.id, statusId)}
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
    </div>
  );
}

function BoardCard({
  project, status, statuses, dragging, onDragStart, onDragEnd, onMove,
  totalSeconds, todaySeconds, lastSeven, openTodos, isRunning, elapsed,
  onOpen, onToggleTimer, onAddTime, onEdit, onDelete,
}) {
  const { color, name } = project;
  const Icon = iconFor(project.icon);
  const finished = status.is_done;

  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`cursor-grab border border-l-[3px] bg-surface transition-opacity active:cursor-grabbing ${
        dragging ? "opacity-40" : ""
      } ${finished ? "border-line" : isRunning ? "" : "border-line"}`}
      style={{
        borderLeftColor: color,
        ...(isRunning ? { background: tint(color, 10), borderColor: tint(color, 55), borderLeftColor: color } : null),
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
        <CardMenu
          name={name}
          status={status}
          statuses={statuses}
          onOpen={onOpen}
          onAddTime={onAddTime}
          onEdit={onEdit}
          onMove={onMove}
          onDelete={onDelete}
        />
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
function CardMenu({ name, status, statuses, onOpen, onAddTime, onEdit, onMove, onDelete }) {
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

  const item = (icon, label, action, { danger, current } = {}) => {
    const Glyph = icon;
    return (
      <button
        role="menuitem"
        disabled={current}
        onClick={() => {
          setOpen(false);
          action();
        }}
        className={`flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-[13px] transition-colors enabled:hover:bg-surface-2 ${
          danger ? "text-danger" : ""
        } ${current ? "text-muted" : ""}`}
      >
        {typeof Glyph === "string" ? (
          <span className="grid size-[15px] place-items-center">
            <span className="size-2" style={{ background: inkFor(Glyph) }} />
          </span>
        ) : (
          <Glyph size={15} />
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {current && <Check size={14} />}
      </button>
    );
  };

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
            {item(NotebookText, "Notes & to-dos", onOpen)}
            {item(Plus, "Add time", onAddTime)}
            {item(Pencil, "Edit", onEdit)}
            <div className="mt-1 border-t border-rule px-2.5 pb-0.5 pt-2 font-serif text-xs italic text-muted">Move to</div>
            {statuses.map((s) => (
              <span key={s.id} className="contents">
                {item(s.color, s.name, () => onMove(s.id), { current: s.id === status.id })}
              </span>
            ))}
            <div className="mt-1 border-t border-rule pt-1">{item(Trash2, "Delete", onDelete, { danger: true })}</div>
          </div>,
          document.body
        )}
    </>
  );
}
