import { useEffect, useRef, useState } from "react";
import { CircleCheck, Ellipsis, Pencil, Play, Plus, RotateCcw, Square, Trash2 } from "lucide-react";
import { ON_INK, iconFor, inkText, tint } from "../lib/palette";
import { fmtClock, fmtHM } from "../lib/time";

/** One ledger row: the project's icon in the margin, its figures in columns,
 *  and the timer control. The running row takes a wash of the project ink. */
export default function ProjectCard({
  project, totalSeconds, todaySeconds, lastSeven, isRunning, elapsed,
  onToggleTimer, onAddTime, onEdit, onToggleDone, onDelete,
}) {
  const { color, name } = project;
  const Icon = iconFor(project.icon);
  const done = project.status === "done";

  return (
    <li className="ledger-row" style={isRunning ? { background: tint(color, 10) } : undefined}>
      <span className="ledger-margin">
        <Icon size={16} strokeWidth={2.25} style={{ color: inkText(color) }} aria-hidden="true" />
      </span>

      <h3 className={`ledger-name font-serif text-[15px] font-medium ${done ? "text-muted" : ""}`} title={name}>
        <span className="min-w-0 truncate">{name}</span>
      </h3>

      <div className="ledger-figs">
        <span className={`ledger-today ${todaySeconds ? "" : "text-muted"}`}>
          <span className="font-serif text-xs italic text-muted sm:sr-only">Today </span>
          <span className="figures">{fmtHM(todaySeconds)}</span>
        </span>
        <Sparkline className="ledger-week" days={lastSeven} color={color} />
        <span className="ledger-total">
          <span className="font-serif text-xs italic text-muted sm:sr-only">Total </span>
          <span className="figures">{fmtHM(totalSeconds)}</span>
        </span>
      </div>

      <div className="ledger-timer">
        {done ? (
          <span className="block min-w-[6.5rem] text-center font-serif text-xs italic text-muted">Done</span>
        ) : (
          <TimerButton running={isRunning} color={color} name={name} elapsed={elapsed} onClick={onToggleTimer} />
        )}
      </div>

      <div className="ledger-menu">
        <CardMenu done={done} onAddTime={onAddTime} onEdit={onEdit} onToggleDone={onToggleDone} onDelete={onDelete} />
      </div>
    </li>
  );
}

function TimerButton({ running, color, name, elapsed, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex h-7 w-full min-w-[6.5rem] items-center justify-center gap-1.5 border text-xs font-semibold transition-colors ${
        running ? "" : "border-line-strong hover:border-text hover:bg-surface-2"
      }`}
      style={running ? { background: color, borderColor: color, color: ON_INK } : undefined}
      aria-label={running ? `Stop ${name}` : `Start ${name}`}
    >
      {running ? (
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
  );
}

/** Last seven days, today on the right. */
function Sparkline({ days, color, className }) {
  const max = Math.max(...days.map((d) => d.secs), 1);
  return (
    <div className={`flex h-3.5 items-end gap-0.5 ${className}`} aria-hidden="true">
      {days.map((d, i) => (
        <div
          key={i}
          title={`${d.label}, ${fmtHM(d.secs)}`}
          className="w-1.5"
          style={{
            height: d.secs ? `${Math.max((d.secs / max) * 100, 18)}%` : "1px",
            background: d.secs ? (i === days.length - 1 ? color : tint(color, 50)) : "var(--faint)",
          }}
        />
      ))}
    </div>
  );
}

function CardMenu({ done, onAddTime, onEdit, onToggleDone, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = (Icon, label, action, danger) => (
    <button
      role="menuitem"
      onClick={() => {
        setOpen(false);
        action();
      }}
      className={`flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-surface-2 ${
        danger ? "text-danger" : ""
      }`}
    >
      <Icon size={15} /> {label}
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="grid size-8 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
        aria-label="Project actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Ellipsis size={17} />
      </button>
      {open && (
        <div role="menu" className="fade-in absolute right-0 top-9 z-20 w-44 border border-line-strong bg-surface p-1">
          {item(Plus, "Add time", onAddTime)}
          {item(Pencil, "Edit", onEdit)}
          {item(done ? RotateCcw : CircleCheck, done ? "Reopen" : "Mark done", onToggleDone)}
          {item(Trash2, "Delete", onDelete, true)}
        </div>
      )}
    </div>
  );
}
