import { useState } from "react";
import { format } from "date-fns";
import { Ban, CalendarPlus, Check, CircleDot, ClipboardPaste, Copy, FolderPlus, Hourglass, PanelRight, Play, Search, Sparkles, Square, X } from "lucide-react";
import { TodoList } from "./ProjectDetail";
import ActionMenu from "./ActionMenu";
import TaskAiPanel from "./TaskAiPanel";
import { copyText, todoAsText } from "../lib/clipboard";
import { buildPrompt } from "../lib/aiTasks";
import { EMPTY_FILTER, FILTER_CHIPS, isFiltering, loadFilter, saveFilter, taskMatches } from "../lib/taskFilter";
import { ON_INK, TASK_INK, iconFor, TASK_ICON } from "../lib/palette";
import { fmtClock, fmtHM, fmtTime, sessionSeconds } from "../lib/time";
import { taskKey } from "../api";

/**
 * The Tasks tab: things to do that aren't part of any project. Each one is ticked off like a to-do, can be
 * marked as being worked on, and takes time like a project does: its own timer (▶, which the pomodoro
 * follows), time logged after the fact, or left open for long work (the hourglass) to close later.
 * `secondsFor(task)` is the time on one, the running timer and open items included.
 * A row keeps to what is always wanted (the time, the timer); the rest of its actions are under its "more" menu.
 * Above the list: filters, and the way to work the list over with an AI (copy it out, paste the answer back).
 */
export default function TasksView({
  tasks, todoOps, runningId, clock, openItems, now, secondsFor, onStart, onStop, onLeaveOpen, onLogTime, onOpenItem, onOpenTask,
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
        <ActionMenu
          label={`More for "${task.text}"`}
          items={[
            { label: "Open its details", icon: PanelRight, onClick: () => onOpenTask(key) },
            { label: "Log time on it", icon: CalendarPlus, onClick: () => onLogTime(key) },
            !item && { label: "Start it and leave it open", icon: Hourglass, onClick: () => onLeaveOpen(key) },
            { label: "Turn it into a project", icon: FolderPlus, onClick: () => todoOps.toProject(task.id) },
          ]}
        />
      </span>
    );
  };

  const subsAll = (task) => tasks.filter((s) => s.parent_id === task.id);
  const openTasks = tasks.filter((x) => !x.done && !x.parent_id);
  const open = openTasks.length;
  const working = tasks.filter((x) => !x.done && x.working_since).length;

  // Filters: the list shows the tasks that pass, each with its sub-tasks
  const [filter, setFilterNow] = useState(loadFilter);
  const setFilter = (next) => {
    setFilterNow(next);
    saveFilter(next);
  };
  const filtering = isFiltering(filter);
  const activeKeys = new Set([runningId, ...openItems.map((x) => x.project_id)]);
  const nowMs = Number(now);
  const passing = new Set(
    openTasks
      .filter((task) =>
        taskMatches(task, filter, { subs: subsAll(task), seconds: secondsFor(task), active: activeKeys.has(taskKey(task.id)), now: nowMs })
      )
      .map((x) => x.id)
  );
  const visible = filtering ? tasks.filter((x) => passing.has(x.id) || (x.parent_id && passing.has(x.parent_id))) : tasks;
  const toggleChip = (id) =>
    setFilter({ ...filter, chips: filter.chips.includes(id) ? filter.chips.filter((c) => c !== id) : [...filter.chips, id] });

  const [copied, setCopied] = useState("");
  const flash = (what) => {
    setCopied(what);
    setTimeout(() => setCopied((c) => (c === what ? "" : c)), 1500);
  };
  const copyList = async () => {
    const text = openTasks.map((x) => todoAsText(x, subsAll(x).filter((s) => !s.done))).join("\n");
    if (text && (await copyText(text))) flash("list");
  };
  const copyForAi = async () => {
    if (await copyText(buildPrompt(openTasks, (t) => subsAll(t).filter((s) => !s.done)))) flash("ai");
  };
  const [aiOpen, setAiOpen] = useState(false);

  return (
    <section className="flex h-full flex-col">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-serif text-[17px] font-semibold">Tasks</h2>
        <span className="font-serif text-xs italic text-muted">
          {filtering ? `${passing.size} of ${open} shown` : `${open} to do`}
          {working > 0 && `, ${working} being worked on`}
        </span>
        <div className="ml-auto flex items-center gap-0.5 self-center">
          {open > 0 && (
            <>
              <HeaderButton onClick={copyList} done={copied === "list"} icon={Copy} title="Copy the tasks still to do as text">
                {copied === "list" ? "Copied" : "Copy list"}
              </HeaderButton>
              <HeaderButton
                onClick={copyForAi}
                done={copied === "ai"}
                icon={Sparkles}
                title="Copy the tasks with a prompt that asks an AI for sub-tasks and an estimate on each"
              >
                {copied === "ai" ? "Copied" : "Copy for AI"}
              </HeaderButton>
            </>
          )}
          <HeaderButton onClick={() => setAiOpen((o) => !o)} pressed={aiOpen} icon={ClipboardPaste} title="Paste an AI's reply to rewrite the tasks">
            Paste AI reply
          </HeaderButton>
        </div>
      </div>
      <p className="mt-0.5 mb-3 text-[13px] text-muted">
        Things to do, and to time, that aren't part of a project. A task happens once: when it's ticked off it's logged
        on that day in the calendar and leaves this list. Time on a task shows on the calendar like a project's.
      </p>

      {aiOpen && <TaskAiPanel tasks={openTasks} subsOf={subsAll} todoOps={todoOps} onClose={() => setAiOpen(false)} />}

      {open > 0 && (
        <div className="mb-2 flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5" role="search" aria-label="Filter the tasks">
          <label className="flex h-8 min-w-[10rem] flex-1 items-center gap-2 border border-line-strong px-2 focus-within:border-text sm:max-w-[16rem]">
            <Search size={14} className="shrink-0 text-muted" aria-hidden="true" />
            <input
              value={filter.q}
              onChange={(e) => setFilter({ ...filter, q: e.target.value })}
              placeholder="Search tasks"
              aria-label="Search tasks"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
            />
          </label>
          {FILTER_CHIPS.map((chip) => {
            const on = filter.chips.includes(chip.id);
            return (
              <button
                key={chip.id}
                onClick={() => toggleChip(chip.id)}
                aria-pressed={on}
                title={chip.hint}
                className={`inline-flex h-8 items-center border px-2.5 text-xs font-semibold transition-colors ${
                  on ? "border-text bg-text text-bg" : "border-line text-muted hover:border-text hover:text-text"
                }`}
              >
                {chip.label}
              </button>
            );
          })}
          {filtering && (
            <button
              onClick={() => setFilter(EMPTY_FILTER)}
              className="inline-flex h-8 items-center gap-1 px-2 text-xs text-muted transition-colors hover:text-text"
            >
              <X size={13} aria-hidden="true" /> Clear
            </button>
          )}
        </div>
      )}
      {filtering && passing.size === 0 && (
        <p className="mb-2 font-serif text-sm italic text-muted">No task matches. Clear the filters to see them all.</p>
      )}

      <TodoList
        todos={visible}
        projectId={null}
        ops={todoOps}
        rowExtra={rowExtra}
        hideDone
        quiet
        placeholder="Add a task and press Enter"
        label="New task"
      />
    </section>
  );
}

/** A small text button in the tab's header. `done` swaps its icon for a tick; `pressed` marks a panel it opens. */
function HeaderButton({ onClick, icon: Icon, done = false, pressed, title, children }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={pressed}
      title={title}
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap px-2 text-xs font-semibold transition-colors hover:bg-surface-2 hover:text-text ${
        pressed ? "bg-surface-2 text-text" : "text-muted"
      }`}
    >
      {done ? <Check size={13} aria-hidden="true" /> : <Icon size={13} aria-hidden="true" />}
      <span className="@max-[34rem]:sr-only">{children}</span>
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
              onClick={() => todoOps.update(task.id, { cancelled: true })}
              className="flex h-8 items-center gap-1.5 border border-line-strong px-2.5 text-xs font-semibold transition-colors hover:border-text hover:bg-surface-2"
              title="Call it off: it leaves the list, its time stays logged"
            >
              <Ban size={13} /> Cancel
            </button>
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
