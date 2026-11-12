import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { ArchiveRestore, ArrowDownToLine, ArrowUpDown, Ban, Check, ChevronDown, CircleDot, Copy, GripVertical, ListChecks, History, Pencil, Play, Plus, Square, Tag, Trash2, Undo2 } from "lucide-react";
import { copyText, todoAsText } from "../lib/clipboard";
import { SORTS, loadSort, saveSort, sortTodos } from "../lib/todoSort";
import { Button } from "./Modal";
import ActionMenu from "./ActionMenu";
import TabBar from "./TabBar";
import ParentTag from "./ParentTag";
import { ON_INK, inkFor, iconFor } from "../lib/palette";
import { fmtClock, fmtHM, fmtTime, sessionSeconds } from "../lib/time";
import { useReorder } from "../hooks/useReorder";

const RECENT = 8;

/** One project opened up, in the side peek: its to-dos and the sessions you've logged on it.
 *  Everything saves as you go.
 *  An archived project has no timer, and offers Restore in its place. */
export default function ProjectDetail({
  project, status, todos, sessions, pomodoroCount = 0, pomodoroTags = [], isRunning, elapsed, totalSeconds, now, archived,
  onEdit, onToggleTimer, onRestore, onCancel, onSaveSessionNote, todoOps, timedTodoId = null, onTimeTodo,
}) {
  const Icon = iconFor(project.icon);
  const finished = status.is_done;
  const [tab, setTab] = useState("todos");
  const openTodos = todos.filter((t) => !t.done).length;
  // A ▶ on each open to-do times it: the project's timer, on that to-do
  const todoTimer = (todo) =>
    todo.done || finished || archived || !onTimeTodo ? null : (
      <TodoTimer todo={todo} timed={todo.id === timedTodoId} elapsed={elapsed} color={project.color} onClick={() => onTimeTodo(todo)} />
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
        <span className="grid size-8 shrink-0 place-items-center" style={{ background: project.color, color: ON_INK }}>
          <Icon size={17} />
        </span>
        <span className="inline-flex items-center gap-1.5 text-[13px]">
          <span className="size-2" style={{ background: inkFor(status.color) }} aria-hidden="true" />
          {status.name}
        </span>
        <span className="font-serif text-[13px] italic text-muted">
          <span className="figures not-italic text-text">{fmtHM(totalSeconds)}</span> logged
        </span>
        {pomodoroCount > 0 && (
          <span className="font-serif text-[13px] italic text-muted" title="Pomodoros this project was worked on during">
            <span className="figures not-italic text-text">{pomodoroCount}</span> {pomodoroCount === 1 ? "pomodoro" : "pomodoros"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {project.cancelled_at && <span className="font-serif text-[13px] italic text-muted">Cancelled</span>}
          {archived && (
            <Button variant="outline" className="h-8" onClick={onRestore}>
              <ArchiveRestore size={14} /> Restore
            </Button>
          )}
          {!finished && !archived && (
            <button
              onClick={onToggleTimer}
              className={`flex h-8 min-w-[6.5rem] items-center justify-center gap-1.5 border text-xs font-semibold transition-colors ${
                isRunning ? "" : "border-line-strong hover:border-text hover:bg-surface-2"
              }`}
              style={isRunning ? { background: project.color, borderColor: project.color, color: ON_INK } : undefined}
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
          <Button variant="outline" className="h-8" onClick={onEdit}>
            <Pencil size={14} /> Edit
          </Button>
          {!archived && onCancel && (
            <Button variant="outline" className="h-8" onClick={onCancel} title="Call it off: it goes to the archive, marked cancelled">
              <Ban size={14} /> Cancel
            </Button>
          )}
        </div>
      </div>

      {/* What the pomodoros this project was worked on during were tagged as */}
      {pomodoroTags.length > 0 && (
        <ul className="-mt-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1" aria-label="Pomodoro tags">
          {pomodoroTags.slice(0, 6).map(([label, count]) => (
            <li
              key={label}
              className="inline-flex max-w-full items-center gap-1 text-[13px]"
              title={`${label}: ${count} ${count === 1 ? "pomodoro" : "pomodoros"}`}
            >
              <Tag size={12} className="shrink-0 text-muted" aria-hidden="true" />
              <span className="truncate">{label}</span>
              {count > 1 && <span className="figures shrink-0 text-xs text-muted">×{count}</span>}
            </li>
          ))}
        </ul>
      )}

      <TabBar
        label="Project"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "todos", label: "To-dos", icon: ListChecks, count: openTodos || undefined },
          { id: "sessions", label: "Sessions", icon: History, count: sessions.length || undefined },
        ]}
      />

      {/* Every panel stays mounted, so a half-typed to-do isn't lost by switching tabs.
          Everything above stays put; only the open panel's own list scrolls. */}
      <div className="flex min-h-[19rem] flex-1 flex-col">
        <div className={tab === "todos" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <TodoList todos={todos} projectId={project.id} ops={todoOps} rowExtra={todoTimer} copyable />
        </div>
        <div className={tab === "sessions" ? "min-h-0 flex-1 overflow-y-auto" : "hidden"}>
          <RecentSessions sessions={sessions} todos={todos} now={now} onSaveNote={onSaveSessionNote} />
        </div>
      </div>
    </div>
  );
}

// ── To-dos ───────────────────────────────────────────────────────────────────

/** The ▶ on a to-do: times it, or, while it is being timed, shows the clock and stops it. Out of the way
 *  (until the row is hovered) when it isn't running. */
function TodoTimer({ todo, timed, elapsed, color, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label={timed ? `Stop timing "${todo.text}"` : `Time "${todo.text}"`}
      title={timed ? "Stop the timer" : "Time this to-do (the project's timer, on this to-do)"}
      className={`inline-flex h-7 min-w-7 shrink-0 items-center justify-center gap-1.5 border px-1.5 text-xs font-semibold transition-colors ${
        timed
          ? ""
          : "border-line-strong text-muted hover:border-text hover:text-text sm:opacity-0 sm:focus:opacity-100 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
      }`}
      style={timed ? { background: color, borderColor: color, color: ON_INK } : undefined}
    >
      {timed ? (
        <>
          <Square size={9} fill="currentColor" aria-hidden="true" />
          <span className="figures">{fmtClock(elapsed)}</span>
        </>
      ) : (
        <Play size={11} fill="currentColor" aria-hidden="true" />
      )}
    </button>
  );
}

/** A to-do list: a project's (`projectId`), or the tasks of their own (`projectId` null). `rowExtra(todo)`
 *  adds controls of the caller's to each top-level row (the Tasks tab's timer, for one). `hideDone` leaves
 *  the finished (and cancelled) ones out altogether: the Tasks tab keeps no list of what is over. `copyable`
 *  adds a button that copies the open to-dos (with their open sub-to-dos) as text. `rowMenu(todo)` gives
 *  the caller's own entries for a row's "more" menu, ahead of the list's (working on, cancel, delete).
 *  The sort button orders the list by when to-dos were added, or by name; Manual is the order you dragged them
 *  into. Dragging while sorted another way makes the order on screen the Manual one. */
export function TodoList({ todos, projectId, ops, rowExtra, rowMenu, hideDone = false, copyable = false, placeholder = "Add a to-do and press Enter", label = "New to-do" }) {
  const [draft, setDraft] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set()); // parents whose sub-to-dos are folded away
  const sortKey = projectId ? "project" : "tasks";
  const [sortMode, setSortMode] = useState(() => loadSort(sortKey));
  const manual = sortMode === "manual";
  const chooseSort = (mode) => {
    setSortMode(mode);
    saveSort(sortKey, mode);
  };
  // Sub-to-dos sit under their parent; one whose parent is gone is shown as a top-level to-do
  const ids = new Set(todos.map((t) => t.id));
  const subsOf = new Map();
  for (const t of todos) {
    if (t.parent_id && ids.has(t.parent_id)) subsOf.set(t.parent_id, [...(subsOf.get(t.parent_id) ?? []), t]);
  }
  for (const [id, list] of subsOf) subsOf.set(id, sortTodos(list, sortMode));
  const top = sortTodos(todos.filter((t) => !t.parent_id || !ids.has(t.parent_id)), sortMode);
  const open = top.filter((t) => !t.done);
  const done = top.filter((t) => t.done);
  // Open and finished to-dos are rearranged separately, each only among its own
  // Pulling an open to-do to the right puts it under the one above it (one with sub-to-dos of its own can't
  // go under another: they only go one level deep); its new parent is opened to show it
  // Moving one while the list is sorted by something else keeps the order on screen, with the move, as the Manual order
  const toManual = () => {
    if (!manual) chooseSort("manual");
  };
  const reorder = (ids) => {
    toManual();
    return ops.reorder(ids);
  };
  const openOrder = useReorder(open.map((t) => t.id), reorder, {
    canNest: (id) => !subsOf.has(id),
    onNest: (id, parentId) => {
      toManual();
      setCollapsed((prev) => {
        if (!prev.has(parentId)) return prev;
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
      ops.nest(id, parentId);
    },
  });
  const doneOrder = useReorder(done.map((t) => t.id), reorder);
  const toggle = (id) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const rowProps = (t, i, order) => ({
    todo: t,
    sort: { row: order.rowProps(i), grip: order.gripProps(t.id, i), held: order.held === t.id, nestTarget: order.nestInto === t.id },
    ops,
    projectId,
    subs: subsOf.get(t.id) ?? [],
    folded: collapsed.has(t.id),
    onToggle: () => toggle(t.id),
    rowExtra,
    rowMenu,
    onManual: toManual,
    canSkip: manual && order === openOrder && i === 0 && open.length > 1,
  });

  const add = async (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    if (!(await ops.add(projectId, text))) setDraft(text);
  };

  const [copied, setCopied] = useState(false);
  const copyList = async () => {
    const text = open.map((t) => todoAsText(t, (subsOf.get(t.id) ?? []).filter((s) => !s.done))).join("\n");
    if (!text || !(await copyText(text))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <form onSubmit={add} className="@container flex shrink-0 items-center gap-2 border-b border-line-strong focus-within:border-text">
        <Plus size={15} className="shrink-0 text-muted" aria-hidden="true" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={200}
          placeholder={placeholder}
          aria-label={label}
          className="h-10 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
        />
        {todos.length > 1 && (
          <label
            className="inline-flex h-7 shrink-0 items-center gap-1.5 px-2 text-xs font-semibold text-muted transition-colors focus-within:bg-surface-2 hover:bg-surface-2 hover:text-text"
            title="Sort the list: Manual is the order you dragged them into"
          >
            <ArrowUpDown size={13} aria-hidden="true" />
            <select
              value={sortMode}
              onChange={(e) => chooseSort(e.target.value)}
              aria-label="Sort the to-dos"
              className="cursor-pointer appearance-none bg-transparent font-semibold outline-none"
            >
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {copyable && open.length > 0 && (
          <button
            type="button"
            onClick={copyList}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 px-2 text-xs font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-text"
            title="Copy the open to-dos as text"
          >
            {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
            <span className="@max-[26rem]:sr-only">{copied ? "Copied" : "Copy list"}</span>
          </button>
        )}
      </form>

      <div data-scroll className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <ul>
        {open.map((t, i) => (
          <TodoRow key={t.id} {...rowProps(t, i, openOrder)} />
        ))}
      </ul>

      {!hideDone && done.length > 0 && (
        <>
          <button
            onClick={() => setShowDone((s) => !s)}
            className="mt-2 flex items-center gap-1.5 py-1 text-[13px] text-muted transition-colors hover:text-text"
            aria-expanded={showDone}
          >
            <ChevronDown size={15} className={`transition-transform ${showDone ? "" : "-rotate-90"}`} />
            {done.some((t) => t.cancelled_at) ? "Done and cancelled" : "Done"} <span className="figures text-xs">({done.length})</span>
          </button>
          {showDone && (
            <ul>
              {done.map((t, i) => (
                <TodoRow key={t.id} {...rowProps(t, i, doneOrder)} />
              ))}
            </ul>
          )}
        </>
      )}
      </div>
    </section>
  );
}

// Browsers without `field-sizing: content` get a textarea sized by hand to fit its text
const AUTO_SIZES = typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content");

function TodoRow({ todo, sort, ops, projectId, subs = [], folded = false, onToggle, isSub = false, rowExtra, rowMenu, onManual, canSkip = false }) {
  const extra = rowExtra?.(todo);
  const [draft, setDraft] = useState(todo.text);
  useEffect(() => setDraft(todo.text), [todo.text]);
  const field = useRef(null);
  useLayoutEffect(() => {
    const el = field.current;
    if (!el || AUTO_SIZES) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);
  const [adding, setAdding] = useState(false);
  const [subDraft, setSubDraft] = useState("");
  const subsDone = subs.filter((s) => s.done && !s.cancelled_at).length;
  const cancelled = Boolean(todo.cancelled_at);
  const showSubs = subs.length > 0 && !folded;
  const subOrder = useReorder(
    subs.map((x) => x.id),
    (ids) => {
      onManual?.();
      return ops.reorder(ids);
    },
    {
      onOutdent: (id) => {
        onManual?.();
        ops.nest(id, null);
      },
    }
  );

  // An emptied line goes back to what it was; delete is the trash button
  const commit = () => {
    const text = draft.trim();
    if (!text || text === todo.text) return setDraft(todo.text);
    ops.update(todo.id, { text });
  };

  const addSub = async (e) => {
    e.preventDefault();
    const text = subDraft.trim();
    if (!text) return;
    setSubDraft("");
    if (!(await ops.add(projectId, text, todo.id))) setSubDraft(text);
  };

  const openAdd = () => {
    setAdding(true);
    if (folded) onToggle();
  };

  const working = Boolean(todo.working_since) && !todo.done;
  // Everything that is only sometimes wanted lives under the row's "more" menu, so it never covers the text
  const menuItems = [
    ...(rowMenu?.(todo) ?? []),
    !todo.done && !working && { label: "Mark as working on", icon: CircleDot, onClick: () => ops.update(todo.id, { working: true }) },
    (!todo.done || cancelled) && {
      label: cancelled ? "Take back the cancelling" : "Cancel (call it off)",
      icon: cancelled ? Undo2 : Ban,
      onClick: () => ops.update(todo.id, { cancelled: !cancelled }),
    },
    { label: subs.length > 0 ? "Delete, with its sub-to-dos" : "Delete", icon: Trash2, danger: true, onClick: () => ops.remove(todo.id) },
  ];

  return (
    <li {...sort.row} className={`${isSub ? "" : "border-b border-rule"} ${sort.row.className ?? ""}`}>
      <div
        className={`group flex items-start gap-2 ${isSub ? "border-t border-rule" : ""} ${
          sort.nestTarget
            ? "bg-[color-mix(in_srgb,var(--accent-2)_14%,transparent)] outline outline-1 -outline-offset-1 outline-accent-2"
            : working
              ? "bg-[color-mix(in_srgb,var(--accent)_7%,transparent)] shadow-[inset_3px_0_0_var(--accent)]"
              : ""
        }`}
      >
        {/* The drag handle is first on the row. Dragging while the list is sorted makes the order on screen the Manual one. */}
        <button
          {...sort.grip}
          aria-label={`Move "${todo.text}": drag, or use the up and down arrow keys. ${
            isSub ? "Left arrow takes it out of its to-do" : "Right arrow puts it under the to-do above"
          }`}
          title={isSub ? "Drag to reorder; pull it left to take it out" : "Drag to reorder; pull it right to put it under the to-do above"}
          className={`mt-1 grid h-7 w-5 shrink-0 touch-none place-items-center text-faint transition-colors hover:bg-surface-2 hover:text-text ${
            sort.held ? "cursor-grabbing text-text" : "cursor-grab"
          }`}
        >
          <GripVertical size={14} />
        </button>
        {isSub && <span className="w-9 shrink-0" aria-hidden="true" />}
        {!isSub && (
          <button
            onClick={subs.length > 0 ? onToggle : openAdd}
            aria-expanded={subs.length > 0 ? !folded : undefined}
            aria-label={
              subs.length > 0
                ? `${folded ? "Show" : "Hide"} sub-to-dos of "${todo.text}"`
                : `Add a sub-to-do under "${todo.text}"`
            }
            title={subs.length > 0 ? (folded ? "Show sub-to-dos" : "Hide sub-to-dos") : "Add a sub-to-do"}
            className="mt-2 grid size-5 shrink-0 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            {subs.length > 0 ? (
              <ChevronDown size={15} className={`transition-transform ${folded ? "-rotate-90" : ""}`} />
            ) : (
              <Plus size={14} />
            )}
          </button>
        )}
        <input
          type="checkbox"
          checked={todo.done}
          onChange={(e) => ops.update(todo.id, { done: e.target.checked })}
          data-cancelled={cancelled || undefined}
          aria-label={`Mark "${todo.text}" ${todo.done ? "not done" : "done"}`}
          className="mt-[10px] size-4 shrink-0 cursor-pointer accent-(--text)"
        />
        {/* The text wraps, so all of it can be read; nothing is laid over it */}
        <textarea
          ref={field}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/\s*\n\s*/g, " "))}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())}
          maxLength={200}
          aria-label={isSub ? "Sub-to-do" : "To-do"}
          className={`field-sizing-content min-h-9 min-w-0 flex-1 resize-none overflow-hidden bg-transparent py-2 text-[14px] leading-5 outline-none focus:bg-surface-2 ${
            todo.done ? "text-muted line-through" : ""
          }`}
        />
        {/* What is always wanted sits at the end of the row; the rest is under the "more" menu */}
        <div className="flex h-9 shrink-0 items-center gap-0.5">
          {cancelled && <span className="mr-1 shrink-0 font-serif text-xs italic text-muted">Cancelled</span>}
          {working && (
            <button
              onClick={() => ops.update(todo.id, { working: false })}
              aria-pressed
              aria-label={`Stop marking "${todo.text}" as being worked on`}
              title={`Working on this since ${format(new Date(todo.working_since), "EEE d MMM, HH:mm")}. Click to unmark`}
              className="inline-flex h-7 shrink-0 items-center gap-1 px-1 text-xs font-semibold text-accent transition-colors hover:bg-surface-2"
            >
              <CircleDot size={14} className="blink-dot" aria-hidden="true" />
              <span className="max-sm:sr-only">Working on</span>
            </button>
          )}
          {extra}
          {subs.length > 0 && (
            <span
              title={`${subsDone} of ${subs.length} sub-to-dos done`}
              className="figures mx-1 shrink-0 font-serif text-xs italic text-muted"
            >
              {subsDone}/{subs.length}
            </span>
          )}
          {canSkip && !todo.done && (
            <button
              onClick={() => ops.moveToBottom(todo.id)}
              aria-label={`Skip "${todo.text}" to the bottom of the list`}
              title="Skip to the bottom of the list"
              className="grid size-7 shrink-0 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
            >
              <ArrowDownToLine size={14} />
            </button>
          )}
          <ActionMenu
            label={`More for "${todo.text}"`}
            items={menuItems}
            className="text-faint"
          />
        </div>
      </div>

      {(showSubs || adding) && (
        <ul>
          {showSubs &&
            subs.map((s, i) => (
              <TodoRow
                key={s.id}
                todo={s}
                sort={{ row: subOrder.rowProps(i), grip: subOrder.gripProps(s.id, i), held: subOrder.held === s.id }}
                ops={ops}
                projectId={projectId}
                rowExtra={rowExtra}
                rowMenu={rowMenu}
                onManual={onManual}
                isSub
              />
            ))}
          {!adding && showSubs && (
            <li className="border-t border-rule pl-[4.5rem]">
              <button
                onClick={openAdd}
                className="flex h-8 items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-text"
              >
                <Plus size={13} aria-hidden="true" /> Add a sub-to-do
              </button>
            </li>
          )}
          {adding && (
            <li className="border-t border-rule pl-[4.5rem]">
              <form onSubmit={addSub} className="flex items-center gap-2">
                <input
                  autoFocus
                  value={subDraft}
                  onChange={(e) => setSubDraft(e.target.value)}
                  onBlur={() => !subDraft.trim() && setAdding(false)}
                  onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
                  maxLength={200}
                  placeholder="Add a sub-to-do and press Enter"
                  aria-label={`New sub-to-do under "${todo.text}"`}
                  className="h-9 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
                />
              </form>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

// ── Sessions ─────────────────────────────────────────────────────────────────

/** What was done in one session. Saves on blur or Enter; the same note the timer's note button writes. */
function SessionNote({ session, onSave }) {
  const [draft, setDraft] = useState(session.note);
  useEffect(() => setDraft(session.note), [session.note]);
  const ready = !String(session.id).startsWith("temp-"); // the server hasn't answered yet

  const commit = () => {
    const note = draft.trim();
    setDraft(note);
    if (note !== session.note) onSave(session.id, note);
  };

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      disabled={!ready}
      maxLength={280}
      placeholder="What did you do?"
      aria-label={`Note for the session on ${format(session.start, "d MMM")} at ${fmtTime(session.start)}`}
      className="mt-1 h-8 w-full bg-transparent px-2 font-serif text-[13px] italic outline-none transition-colors placeholder:text-faint hover:bg-surface-2/60 focus:bg-surface-2 disabled:opacity-50"
    />
  );
}

/** The to-dos ticked off while `session` was open (a running one counts up to now). */
function doneDuring(todos, session, now) {
  const end = session.end ?? now;
  return todos.filter((t) => {
    if (!t.done || !t.completed_at) return false;
    const at = new Date(t.completed_at);
    return at >= session.start && at <= end;
  });
}

function RecentSessions({ sessions, todos, now, onSaveNote }) {
  const [all, setAll] = useState(false);
  if (sessions.length === 0) {
    return <p className="py-6 text-center font-serif text-sm italic text-muted">No time logged on this project yet.</p>;
  }
  const shown = all ? sessions : sessions.slice(0, RECENT);
  const todosById = new Map(todos.map((t) => [t.id, t]));

  return (
    <section>
      <p className="mb-2 font-serif text-xs italic text-muted">Write what you did on any session. Saves when you click away.</p>
      <ul className="border-t border-rule">
        {shown.map((s) => (
          <li key={s.id} className="border-b border-rule py-2">
            <div className="flex items-baseline gap-3 text-[13px]">
              <span className="figures w-24 shrink-0 text-muted">{format(s.start, "EEE d MMM")}</span>
              <span className="figures min-w-0 flex-1 whitespace-nowrap text-muted sm:flex-none sm:w-44">
                {fmtTime(s.start)}
                {" – "}
                {s.end ? fmtTime(s.end) : "now"}
              </span>
              <span className="figures w-14 shrink-0 text-right font-semibold">{fmtHM(sessionSeconds(s, now))}</span>
            </div>
            {s.todo_id && todosById.has(s.todo_id) && (
              <p className="mt-0.5 flex items-center gap-1.5 px-2 text-[13px]">
                <Play size={10} fill="currentColor" className="shrink-0 text-muted" aria-label="On the to-do" />
                <span className="min-w-0 truncate">{todosById.get(s.todo_id).text}</span>
              </p>
            )}
            <SessionNote session={s} onSave={onSaveNote} />
            {doneDuring(todos, s, now).map((t) => (
              <p key={t.id} className="mt-0.5 flex items-start gap-1.5 px-2 text-[13px] text-muted">
                <Check size={13} className="mt-[3px] shrink-0" aria-hidden="true" />
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="min-w-0 break-words">{t.text}</span>
                  <ParentTag todo={t} todosById={todosById} />
                </span>
              </p>
            ))}
          </li>
        ))}
      </ul>
      {sessions.length > RECENT && (
        <button
          onClick={() => setAll((a) => !a)}
          className="mt-2 text-[13px] text-muted underline underline-offset-2 transition-colors hover:text-text"
        >
          {all ? "Show fewer" : `Show all ${sessions.length}`}
        </button>
      )}
    </section>
  );
}
