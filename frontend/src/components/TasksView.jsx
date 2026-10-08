import { format } from "date-fns";
import { CalendarPlus, CircleDot, Hourglass, Play, Square } from "lucide-react";
import { TodoList } from "./ProjectDetail";
import { ON_INK, TASK_INK, iconFor, TASK_ICON } from "../lib/palette";
import { fmtClock, fmtHM, fmtTime, sessionSeconds } from "../lib/time";
import { taskKey } from "../api";

/**
 * The Tasks tab: things to do that aren't part of any project. Each one is ticked off like a to-do, can be
 * marked as being worked on, and takes time like a project does: its own timer (▶, which the pomodoro
 * follows), time logged after the fact, or left open for long work (the hourglass) to close later.
 * `secondsFor(task)` is the time on one, the running timer and open items included.
 */
export default function TasksView({
  tasks, todoOps, runningId, clock, openItems, now, secondsFor, onStart, onStop, onLeaveOpen, onLogTime, onOpenItem,
}) {
  const openFor = new Map(openItems.map((x) => [x.project_id, x]));

  const rowExtra = (task) => {
    if (task.parent_id) return null;
    if (task.done) {
      const secs = secondsFor(task);
      return secs >= 60 ? <span className="figures shrink-0 text-xs text-muted">{fmtHM(secs)}</span> : null;
    }
    const key = taskKey(task.id);
    const running = runningId === key;
    const item = openFor.get(key);
    // What is logged; the open item's time so far shows on its own, by the hourglass
    const secs = secondsFor(task) - (item ? Math.max(0, (now - item.start) / 1000) : 0);
    return (
      <span className="flex shrink-0 items-center gap-0.5">
        {item && (
          <button
            onClick={() => onOpenItem(item)}
            className="inline-flex h-7 items-center gap-1 px-1.5 text-xs font-semibold text-accent-2 transition-colors hover:bg-surface-2"
            title={`Open since ${format(item.start, "EEE d MMM, HH:mm")}. Click to close or edit`}
          >
            <Hourglass size={12} aria-hidden="true" />
            <span className="figures">{fmtHM((now - item.start) / 1000)}</span>
          </button>
        )}
        {secs >= 60 && !running && <span className="figures px-1 text-xs text-muted" title="Time logged">{fmtHM(secs)}</span>}
        <IconButton label="Log time on it" onClick={() => onLogTime(key)} className="max-sm:hidden">
          <CalendarPlus size={14} />
        </IconButton>
        {!item && (
          <IconButton label="Start it and leave it open, for long work" onClick={() => onLeaveOpen(key)}>
            <Hourglass size={14} />
          </IconButton>
        )}
        <button
          onClick={() => (running ? onStop() : onStart(key))}
          aria-label={running ? `Stop the timer on "${task.text}"` : `Start the timer on "${task.text}"`}
          title={running ? "Stop the timer" : "Start the timer"}
          className={`inline-flex h-7 min-w-7 items-center justify-center gap-1.5 border px-1.5 text-xs font-semibold transition-colors ${
            running ? "" : "border-line-strong text-muted hover:border-text hover:text-text"
          }`}
          style={running ? { background: TASK_INK, borderColor: TASK_INK, color: ON_INK } : undefined}
        >
          {running ? (
            <>
              <Square size={9} fill="currentColor" aria-hidden="true" />
              <span className="figures">{fmtClock(clock)}</span>
            </>
          ) : (
            <Play size={11} fill="currentColor" aria-hidden="true" />
          )}
        </button>
      </span>
    );
  };

  const open = tasks.filter((x) => !x.done && !x.parent_id).length;
  const working = tasks.filter((x) => !x.done && x.working_since).length;

  return (
    <section className="mx-auto flex h-full max-w-3xl flex-col">
      <div className="flex items-baseline gap-3">
        <h2 className="font-serif text-[17px] font-semibold">Tasks</h2>
        <span className="font-serif text-xs italic text-muted">
          {open} to do{working > 0 && `, ${working} being worked on`}
        </span>
      </div>
      <p className="mt-0.5 mb-3 text-[13px] text-muted">
        Things to do, and to time, that aren't part of a project. Time on a task shows on the calendar like a project's.
      </p>
      <TodoList
        todos={tasks}
        projectId={null}
        ops={todoOps}
        rowExtra={rowExtra}
        placeholder="Add a task and press Enter"
        label="New task"
      />
    </section>
  );
}

function IconButton({ label, onClick, className = "", children }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`grid size-7 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text ${className}`}
    >
      {children}
    </button>
  );
}

/** A task opened up (in the side peek, or the pomodoro's full screen): its timer, whether it is being worked
 *  on, ticking it off, and the time logged on it. */
export function TaskDetail({ task, sessions, totalSeconds, isRunning, elapsed, now, todoOps, onToggleTimer, onLeaveOpen }) {
  const Icon = iconFor(TASK_ICON);
  const working = Boolean(task.working_since) && !task.done;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
        <span className="grid size-8 shrink-0 place-items-center" style={{ background: TASK_INK, color: ON_INK }}>
          <Icon size={17} />
        </span>
        <span className="text-[13px] text-muted">Task</span>
        <span className="font-serif text-[13px] italic text-muted">
          <span className="figures not-italic text-text">{fmtHM(totalSeconds)}</span> logged
        </span>
        {!task.done && (
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={onLeaveOpen}
              className="flex h-8 items-center gap-1.5 border border-line-strong px-2.5 text-xs font-semibold transition-colors hover:border-text hover:bg-surface-2"
              title="Start it and leave it open, for long work"
            >
              <Hourglass size={13} /> Leave open
            </button>
            <button
              onClick={onToggleTimer}
              className={`flex h-8 min-w-[6.5rem] items-center justify-center gap-1.5 border text-xs font-semibold transition-colors ${
                isRunning ? "" : "border-line-strong hover:border-text hover:bg-surface-2"
              }`}
              style={isRunning ? { background: TASK_INK, borderColor: TASK_INK, color: ON_INK } : undefined}
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
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-y border-rule py-2">
        <label className="flex cursor-pointer items-center gap-2 text-[14px]">
          <input
            type="checkbox"
            checked={task.done}
            onChange={(e) => todoOps.update(task.id, { done: e.target.checked })}
            className="size-4 cursor-pointer accent-(--text)"
          />
          <span className={task.done ? "text-muted line-through" : ""}>{task.text}</span>
        </label>
        {!task.done && (
          <button
            onClick={() => todoOps.update(task.id, { working: !working })}
            aria-pressed={working}
            className={`ml-auto inline-flex h-7 items-center gap-1.5 px-2 text-xs font-semibold transition-colors hover:bg-surface-2 ${
              working ? "text-accent" : "text-muted hover:text-text"
            }`}
          >
            <CircleDot size={14} className={working ? "blink-dot" : ""} aria-hidden="true" />
            {working ? "Working on it" : "Mark as working on"}
          </button>
        )}
      </div>

      <section className="min-h-0 flex-1 overflow-y-auto">
        <h3 className="border-b border-rule py-1 font-serif text-xs italic text-muted">Sessions</h3>
        {sessions.length === 0 ? (
          <p className="py-3 text-[13px] text-muted">No time on it yet.</p>
        ) : (
          <ul>
            {sessions.map((s) => (
              <li key={s.id} className="flex h-9 items-center gap-3 border-b border-rule text-[13px]">
                <span className="figures w-24 shrink-0 text-muted">{format(s.start, "EEE d MMM")}</span>
                <span className="figures shrink-0">
                  {fmtTime(s.start)}–{s.end ? fmtTime(s.end) : "now"}
                </span>
                <span className="min-w-0 flex-1 truncate font-serif text-xs italic text-muted">{s.note}</span>
                <span className="figures shrink-0 font-semibold">{fmtHM(sessionSeconds(s, now))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
