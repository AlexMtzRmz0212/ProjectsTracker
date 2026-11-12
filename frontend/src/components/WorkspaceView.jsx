import { useState } from "react";
import { CircleDot, ListChecks, Play, Plus, Search, Square, Tag, Target } from "lucide-react";
import { dayState, entriesByDay, dayKey, streakOf } from "../lib/habits";
import { TASK_INK, iconFor, inkText } from "../lib/palette";

const LIMIT = 6; // rows a group shows before "Show all"

/**
 * The Workspace tab: one place to choose what to work on, from everything that can be worked on. Each row has a
 * Start button that does what starting it does elsewhere:
 * - what is already being worked on (to-dos marked so) comes first;
 * - projects and tasks start their timer (a pomodoro goes with it if none is going);
 * - habits and chores have no timer: starting one starts a focus (a pomodoro) with its name as what it is for.
 * `chores` are the words earlier focuses were for; a new one can be typed in. The box above searches all of it.
 */
export default function WorkspaceView({
  working, projects, tasks, habits, chores, runningId, timedTodoId = null, focusLabel, today, onStartSubject, onStartTodo, onStartChore, onStop,
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const has = (text) => !q || text.toLowerCase().includes(q);
  const typedIsNew = q && ![...chores, ...habits.map((h) => h.name)].some((c) => c.toLowerCase() === q);

  const workingRows = working.filter((w) => has(w.todo.text) || has(w.context));
  const projectRows = projects.filter((p) => has(p.name));
  const taskRows = tasks.filter((p) => has(p.name));
  const habitRows = habits.filter((h) => has(h.name));
  const choreRows = chores.filter(has);
  const nothing = workingRows.length + projectRows.length + taskRows.length + habitRows.length + choreRows.length === 0;

  const key = dayKey(today);
  const focusing = (label) => focusLabel === label;

  return (
    <section className="flex h-full flex-col">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-serif text-[17px] font-semibold">Workspace</h2>
        <span className="font-serif text-xs italic text-muted">what to work on</span>
      </div>
      <p className="mt-0.5 mb-3 text-[13px] text-muted">
        Pick one: projects, tasks and to-dos start their timer, and habits and chores start a pomodoro for them.
      </p>

      <label className="mb-2 flex h-9 shrink-0 items-center gap-2 border border-line-strong px-2.5 focus-within:border-text">
        <Search size={14} className="shrink-0 text-muted" aria-hidden="true" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && typedIsNew && (onStartChore(query.trim().slice(0, 120)), setQuery(""))}
          placeholder="Search, or type a chore and press Enter"
          aria-label="Search what to work on"
          maxLength={120}
          className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
        />
      </label>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {typedIsNew && (
          <Row
            icon={<Plus size={14} className="text-muted" aria-hidden="true" />}
            name={<>Use "<b>{query.trim()}</b>" as a chore</>}
            action={{ label: "Start", icon: Play, onClick: () => (onStartChore(query.trim().slice(0, 120)), setQuery("")) }}
          />
        )}

        <Group title="Being worked on" icon={CircleDot} rows={workingRows}>
          {(w) => {
            const running = timedTodoId === w.todo.id;
            return (
              <Row
                key={w.todo.id}
                icon={<CircleDot size={14} className="blink-dot text-accent" aria-hidden="true" />}
                name={w.todo.text}
                meta={w.context}
                running={running}
                action={running ? { label: "Stop", icon: Square, onClick: onStop } : { label: "Start", icon: Play, onClick: () => onStartTodo(w.todo) }}
              />
            );
          }}
        </Group>

        <Group title="Projects" icon={ListChecks} rows={projectRows}>
          {(p) => {
            const Icon = iconFor(p.icon);
            const running = runningId === p.id;
            return (
              <Row
                key={p.id}
                icon={<Icon size={14} style={{ color: inkText(p.color) }} aria-hidden="true" />}
                name={p.name}
                running={running}
                action={running ? { label: "Stop", icon: Square, onClick: onStop } : { label: "Start", icon: Play, onClick: () => onStartSubject(p.id) }}
              />
            );
          }}
        </Group>

        <Group title="Tasks" icon={ListChecks} rows={taskRows}>
          {(p) => {
            const Icon = iconFor(p.icon);
            const running = runningId === p.id;
            return (
              <Row
                key={p.id}
                icon={<Icon size={14} style={{ color: TASK_INK }} aria-hidden="true" />}
                name={p.name}
                running={running}
                action={running ? { label: "Stop", icon: Square, onClick: onStop } : { label: "Start", icon: Play, onClick: () => onStartSubject(p.id) }}
              />
            );
          }}
        </Group>

        <Group title="Habits" icon={Target} rows={habitRows} order={(h) => (entriesByDay(h).has(key) ? 1 : 0)}>
          {(h) => {
            const state = dayState(h, entriesByDay(h).get(key));
            const streak = streakOf(h, today);
            return (
              <Row
                key={h.id}
                icon={<Target size={14} className={state === "done" ? "text-accent-2" : "text-muted"} aria-hidden="true" />}
                name={h.name}
                meta={[state === "done" ? "done today" : state === "none" ? "not logged today" : state === "skip" ? "skipped today" : "missed today", streak > 0 ? `${streak} day streak` : null]
                  .filter(Boolean)
                  .join(", ")}
                running={focusing(h.name)}
                action={{ label: focusing(h.name) ? "Focusing" : "Start", icon: Play, onClick: () => onStartChore(h.name), disabled: focusing(h.name) }}
              />
            );
          }}
        </Group>

        <Group title="Chores" icon={Tag} rows={choreRows}>
          {(label) => (
            <Row
              key={label}
              icon={<Tag size={14} className="text-muted" aria-hidden="true" />}
              name={label}
              running={focusing(label)}
              action={{ label: focusing(label) ? "Focusing" : "Start", icon: Play, onClick: () => onStartChore(label), disabled: focusing(label) }}
            />
          )}
        </Group>

        {nothing && !typedIsNew && <p className="py-4 font-serif text-sm italic text-muted">Nothing matches "{query.trim()}".</p>}
      </div>
    </section>
  );
}

/** A titled group of rows; shows the first few, with the rest a click away. `order(row)` ranks rows (lower first). */
function Group({ title, icon: Icon, rows, order, children }) {
  const [all, setAll] = useState(false);
  if (rows.length === 0) return null;
  const sorted = order ? [...rows].sort((a, b) => order(a) - order(b)) : rows;
  const shown = all ? sorted : sorted.slice(0, LIMIT);
  return (
    <section className="mb-4">
      <h3 className="flex items-center gap-1.5 border-b border-rule py-1 font-serif text-xs italic text-muted">
        <Icon size={12} aria-hidden="true" /> {title} <span className="figures not-italic">{rows.length}</span>
      </h3>
      <ul>{shown.map((r) => children(r))}</ul>
      {rows.length > LIMIT && (
        <button
          onClick={() => setAll((a) => !a)}
          className="mt-1 text-[13px] text-muted underline underline-offset-2 transition-colors hover:text-text"
        >
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  );
}

function Row({ icon, name, meta, running = false, action }) {
  const Action = action.icon;
  return (
    <li className={`flex min-h-10 items-center gap-2.5 border-b border-rule ${running ? "bg-[color-mix(in_srgb,var(--accent)_7%,transparent)] shadow-[inset_3px_0_0_var(--accent)]" : ""}`}>
      <span className="grid size-5 shrink-0 place-items-center pl-1">{icon}</span>
      <span className="min-w-0 flex-1 py-1.5 text-[14px]">
        <span className="break-words">{name}</span>
        {meta && <span className="ml-2 font-serif text-xs italic text-muted">{meta}</span>}
      </span>
      <button
        onClick={action.onClick}
        disabled={action.disabled}
        className={`mr-1 inline-flex h-8 shrink-0 items-center gap-1.5 border px-2.5 text-xs font-semibold transition-colors disabled:pointer-events-none ${
          running ? "border-accent text-accent" : "border-line-strong hover:border-text hover:bg-surface-2"
        }`}
      >
        <Action size={11} fill="currentColor" aria-hidden="true" /> {action.label}
      </button>
    </li>
  );
}
