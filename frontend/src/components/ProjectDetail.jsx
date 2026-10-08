import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { ArchiveRestore, Check, ChevronDown, GripVertical, ListChecks, NotebookText, History, Pencil, Play, Plus, Square, Trash2 } from "lucide-react";
import { Button } from "./Modal";
import TabBar from "./TabBar";
import ParentTag from "./ParentTag";
import { ON_INK, inkFor, iconFor } from "../lib/palette";
import { fmtClock, fmtHM, fmtTime, sessionSeconds } from "../lib/time";
import { useReorder } from "../hooks/useReorder";

const RECENT = 8;

/** One project opened up, in the side peek: its to-dos, free-form notes, and the sessions you've logged on it.
 *  Everything saves as you go; peeking at another project saves a note you were still typing.
 *  An archived project has no timer, and offers Restore in its place. */
export default function ProjectDetail({
  project, status, todos, sessions, pomodoroCount = 0, isRunning, elapsed, totalSeconds, now, archived,
  onEdit, onToggleTimer, onRestore, onSaveNotes, onSaveSessionNote, todoOps,
}) {
  const Icon = iconFor(project.icon);
  const finished = status.is_done;
  const [tab, setTab] = useState("todos");
  const openTodos = todos.filter((t) => !t.done).length;

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
        </div>
      </div>

      <TabBar
        label="Project"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "todos", label: "To-dos", icon: ListChecks, count: openTodos || undefined },
          { id: "notes", label: "Notes", icon: NotebookText },
          { id: "sessions", label: "Sessions", icon: History, count: sessions.length || undefined },
        ]}
      />

      {/* Every panel stays mounted so a half-typed note isn't lost by switching tabs.
          Everything above stays put; only the open panel's own list scrolls. */}
      <div className="flex min-h-[19rem] flex-1 flex-col">
        <div className={tab === "todos" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <TodoList todos={todos} projectId={project.id} ops={todoOps} />
        </div>
        <div className={tab === "notes" ? "min-h-0 flex-1 overflow-y-auto" : "hidden"}>
          <Notes key={project.id} value={project.notes} onSave={onSaveNotes} />
        </div>
        <div className={tab === "sessions" ? "min-h-0 flex-1 overflow-y-auto" : "hidden"}>
          <RecentSessions sessions={sessions} todos={todos} now={now} onSaveNote={onSaveSessionNote} />
        </div>
      </div>
    </div>
  );
}

// ── To-dos ───────────────────────────────────────────────────────────────────

function TodoList({ todos, projectId, ops }) {
  const [draft, setDraft] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set()); // parents whose sub-to-dos are folded away
  // Sub-to-dos sit under their parent; one whose parent is gone is shown as a top-level to-do
  const ids = new Set(todos.map((t) => t.id));
  const subsOf = new Map();
  for (const t of todos) {
    if (t.parent_id && ids.has(t.parent_id)) subsOf.set(t.parent_id, [...(subsOf.get(t.parent_id) ?? []), t]);
  }
  const top = todos.filter((t) => !t.parent_id || !ids.has(t.parent_id));
  const open = top.filter((t) => !t.done);
  const done = top.filter((t) => t.done);
  // Open and finished to-dos are rearranged separately, each only among its own
  const openOrder = useReorder(open.map((t) => t.id), ops.reorder);
  const doneOrder = useReorder(done.map((t) => t.id), ops.reorder);
  const toggle = (id) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const rowProps = (t, i, order) => ({
    todo: t,
    sort: { row: order.rowProps(i), grip: order.gripProps(t.id, i), held: order.held === t.id },
    ops,
    projectId,
    showTime: sharesDay(t),
    sharesDay,
    subs: subsOf.get(t.id) ?? [],
    folded: collapsed.has(t.id),
    onToggle: () => toggle(t.id),
  });
  // Days that more than one to-do was added on: those show the time too, to tell them apart
  const dayCounts = new Map();
  for (const t of todos) {
    const day = dayKey(t);
    if (day) dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }
  const sharesDay = (t) => dayCounts.get(dayKey(t)) > 1;

  const add = async (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    if (!(await ops.add(projectId, text))) setDraft(text);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <form onSubmit={add} className="flex shrink-0 items-center gap-2 border-b border-line-strong focus-within:border-text">
        <Plus size={15} className="shrink-0 text-muted" aria-hidden="true" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={200}
          placeholder="Add a to-do and press Enter"
          aria-label="New to-do"
          className="h-10 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
        />
      </form>

      <div data-scroll className="min-h-0 flex-1 overflow-y-auto">
      <ul>
        {open.map((t, i) => (
          <TodoRow key={t.id} {...rowProps(t, i, openOrder)} />
        ))}
      </ul>

      {done.length > 0 && (
        <>
          <button
            onClick={() => setShowDone((s) => !s)}
            className="mt-2 flex items-center gap-1.5 py-1 text-[13px] text-muted transition-colors hover:text-text"
            aria-expanded={showDone}
          >
            <ChevronDown size={15} className={`transition-transform ${showDone ? "" : "-rotate-90"}`} />
            Done <span className="figures text-xs">({done.length})</span>
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

/** The calendar day a to-do was added, in local time; null if the server sent no date. */
const dayKey = (todo) => (todo.created_at ? format(new Date(todo.created_at), "yyyy-MM-dd") : null);

function TodoRow({ todo, sort, ops, projectId, showTime, sharesDay, subs = [], folded = false, onToggle, isSub = false }) {
  const [draft, setDraft] = useState(todo.text);
  useEffect(() => setDraft(todo.text), [todo.text]);
  const [adding, setAdding] = useState(false);
  const [subDraft, setSubDraft] = useState("");
  const created = todo.created_at ? new Date(todo.created_at) : null;
  const subsDone = subs.filter((s) => s.done).length;
  const showSubs = subs.length > 0 && !folded;
  const subOrder = useReorder(subs.map((x) => x.id), ops.reorder);

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

  const reveal = "sm:opacity-0 sm:focus:opacity-100 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100";

  return (
    <li {...sort.row} className={`${isSub ? "" : "border-b border-rule"} ${sort.row.className ?? ""}`}>
      <div className={`group flex items-center gap-2.5 ${isSub ? "border-t border-rule pl-11" : ""}`}>
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
            className="grid size-5 shrink-0 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
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
          aria-label={`Mark "${todo.text}" ${todo.done ? "not done" : "done"}`}
          className="size-4 shrink-0 cursor-pointer accent-(--text)"
        />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          maxLength={200}
          aria-label={isSub ? "Sub-to-do" : "To-do"}
          className={`h-9 min-w-0 flex-1 bg-transparent text-[14px] outline-none focus:bg-surface-2 ${
            todo.done ? "text-muted line-through" : ""
          }`}
        />
        {subs.length > 0 && (
          <span
            title={`${subsDone} of ${subs.length} sub-to-dos done`}
            className="figures shrink-0 font-serif text-xs italic text-muted"
          >
            {subsDone}/{subs.length}
          </span>
        )}
        {created && (
          <time
            dateTime={created.toISOString()}
            title={`Added ${format(created, "EEE d MMM yyyy, HH:mm")}`}
            className="figures shrink-0 font-serif text-xs italic text-faint"
          >
            {format(created, created.getFullYear() === new Date().getFullYear() ? "d MMM" : "d MMM yyyy")}
            {showTime && `, ${format(created, "HH:mm")}`}
          </time>
        )}
        <button
          {...sort.grip}
          aria-label={`Move "${todo.text}": drag, or use the up and down arrow keys`}
          title="Drag to reorder"
          className={`grid size-8 shrink-0 touch-none place-items-center text-faint transition-colors hover:bg-surface-2 hover:text-text ${
            sort.held ? "cursor-grabbing text-text sm:opacity-100" : `cursor-grab ${reveal}`
          }`}
        >
          <GripVertical size={14} />
        </button>
        <button
          onClick={() => ops.remove(todo.id)}
          aria-label={`Delete "${todo.text}"`}
          title={subs.length > 0 ? "Delete, with its sub-to-dos" : "Delete"}
          className={`grid size-8 shrink-0 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-danger ${reveal}`}
        >
          <Trash2 size={14} />
        </button>
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
                showTime={sharesDay(s)}
                sharesDay={sharesDay}
                isSub
              />
            ))}
          {!adding && showSubs && (
            <li className="border-t border-rule pl-11">
              <button
                onClick={openAdd}
                className="flex h-8 items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-text"
              >
                <Plus size={13} aria-hidden="true" /> Add a sub-to-do
              </button>
            </li>
          )}
          {adding && (
            <li className="border-t border-rule pl-11">
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

// ── Notes ────────────────────────────────────────────────────────────────────

function Notes({ value, onSave }) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(draft);
  const savedRef = useRef(value);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  const save = () => {
    if (draftRef.current === savedRef.current) return;
    savedRef.current = draftRef.current;
    saveRef.current(draftRef.current);
  };
  // Closing the window while the cursor is still in the box must not lose the text
  useEffect(() => save, []);

  return (
    <section>
      <p className="mb-2 font-serif text-xs italic text-muted">Saves when you click away.</p>
      <textarea
        value={draft}
        onChange={(e) => {
          draftRef.current = e.target.value;
          setDraft(e.target.value);
        }}
        onBlur={save}
        maxLength={20000}
        rows={10}
        placeholder="Ideas, links, where you left off…"
        aria-label="Project notes"
        className="w-full resize-y border border-line-strong bg-transparent p-3 text-[14px] leading-relaxed outline-none transition-colors placeholder:text-faint focus:border-text"
      />
    </section>
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
