import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { Check, ChevronDown, ListChecks, NotebookText, History, Pencil, Play, Plus, Square, Trash2 } from "lucide-react";
import Modal, { Button } from "./Modal";
import TabBar from "./TabBar";
import { ON_INK, inkFor, iconFor } from "../lib/palette";
import { fmtClock, fmtHM, fmtTime, sessionSeconds } from "../lib/time";

const RECENT = 8;

/** One project opened up: its to-dos, free-form notes, and the sessions you've logged on it.
 *  Everything saves as you go; closing the window saves a note you were still typing. */
export default function ProjectDetail({
  project, status, todos, sessions, isRunning, elapsed, totalSeconds, now,
  onClose, onEdit, onToggleTimer, onSaveNotes, onSaveSessionNote, todoOps,
}) {
  const Icon = iconFor(project.icon);
  const finished = status.is_done;
  const [tab, setTab] = useState("todos");
  const openTodos = todos.filter((t) => !t.done).length;

  return (
    <Modal title={project.name} wide onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
          <div className="ml-auto flex items-center gap-1.5">
            {!finished && (
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

        {/* Every panel stays mounted so a half-typed note isn't lost by switching tabs */}
        <div className="min-h-[19rem]">
          <div hidden={tab !== "todos"}>
            <TodoList todos={todos} projectId={project.id} ops={todoOps} />
          </div>
          <div hidden={tab !== "notes"}>
            <Notes key={project.id} value={project.notes} onSave={onSaveNotes} />
          </div>
          <div hidden={tab !== "sessions"}>
            <RecentSessions sessions={sessions} todos={todos} now={now} onSaveNote={onSaveSessionNote} />
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── To-dos ───────────────────────────────────────────────────────────────────

function TodoList({ todos, projectId, ops }) {
  const [draft, setDraft] = useState("");
  const [showDone, setShowDone] = useState(false);
  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

  const add = async (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    if (!(await ops.add(projectId, text))) setDraft(text);
  };

  return (
    <section>
      <form onSubmit={add} className="flex items-center gap-2 border-b border-line-strong focus-within:border-text">
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

      <ul>
        {open.map((t) => (
          <TodoRow key={t.id} todo={t} ops={ops} />
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
              {done.map((t) => (
                <TodoRow key={t.id} todo={t} ops={ops} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function TodoRow({ todo, ops }) {
  const [draft, setDraft] = useState(todo.text);
  useEffect(() => setDraft(todo.text), [todo.text]);

  // An emptied line goes back to what it was; delete is the trash button
  const commit = () => {
    const text = draft.trim();
    if (!text || text === todo.text) return setDraft(todo.text);
    ops.update(todo.id, { text });
  };

  return (
    <li className="group flex items-center gap-2.5 border-b border-rule">
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
        aria-label="To-do"
        className={`h-9 min-w-0 flex-1 bg-transparent text-[14px] outline-none focus:bg-surface-2 ${
          todo.done ? "text-muted line-through" : ""
        }`}
      />
      <button
        onClick={() => ops.remove(todo.id)}
        aria-label={`Delete "${todo.text}"`}
        title="Delete"
        className="grid size-8 shrink-0 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-danger sm:opacity-0 sm:focus:opacity-100 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
      >
        <Trash2 size={14} />
      </button>
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
                <span className="min-w-0 break-words">{t.text}</span>
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
