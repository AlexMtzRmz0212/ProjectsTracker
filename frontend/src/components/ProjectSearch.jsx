import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import Modal from "./Modal";
import { taskKey } from "../api";
import { ON_INK, TASK_ICON, TASK_INK, inkFor, inkText, iconFor, tint } from "../lib/palette";

/** Not a project: the Tasks tab, offered at the top of every search (here, in the pomodoro's full screen and
 *  in the mini clock) so the tasks are a Ctrl+F away from anywhere in the app. */
export const TASKS_TAB = { id: "tab:tasks", kind: "tab", name: "Tasks", color: TASK_INK, icon: TASK_ICON, archived_at: null };

/** The list a search works through: the Tasks tab first when there is somewhere to show it (`onTasks`). */
export const withTasksTab = (projects, onTasks) => (onTasks ? [TASKS_TAB, ...projects] : projects);

/** The open to-dos to find by name, each filed under what it belongs to (`subjects`, by id): a project's to-do
 *  under the project, a task's sub-to-do under the task at the top. A task itself is one of the subjects, so it
 *  isn't listed again. Each carries its subject's look and an `in` naming it. */
export function todoEntries(todos, subjects) {
  const subjectsById = new Map(subjects.map((s) => [s.id, s]));
  const byId = new Map(todos.map((x) => [x.id, x]));
  return todos.flatMap((x) => {
    if (x.done || (!x.project_id && !x.parent_id)) return [];
    let top = x;
    while (!top.project_id && top.parent_id && byId.has(top.parent_id)) top = byId.get(top.parent_id);
    const subject = subjectsById.get(x.project_id ?? taskKey(top.id));
    if (!subject) return [];
    return [{
      id: `todo:${x.id}`, kind: "todo", todoId: x.id, subjectId: subject.id, name: x.text, in: subject.name,
      color: subject.color, icon: subject.icon, archived_at: subject.archived_at, working: Boolean(x.working_since),
    }];
  });
}

/** What a search lists for `query`: projects and tasks (and the Tasks tab) first, then, once something is typed,
 *  the to-dos that match, so the to-dos never crowd the list before there is something to look for. */
export const searchResults = (subjects, todos, query) => [
  ...matchProjects(subjects, query),
  ...(query.trim() ? matchProjects(todos, query) : []),
];

/** The projects whose name holds every word typed, best first: names that start with the
 *  query, then ones with a word that does, then the rest. Live projects come before archived
 *  ones, and ties keep the order given. An empty query lists everything. */
export function matchProjects(projects, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const rank = (p) => {
    const name = p.name.toLowerCase();
    if (!words.every((w) => name.includes(w))) return null;
    if (words.length === 0 || name.startsWith(words[0])) return 0;
    return name.split(/\s+/).some((part) => part.startsWith(words[0])) ? 1 : 2;
  };
  return projects
    .map((project) => ({ project, rank: rank(project) }))
    .filter((x) => x.rank !== null)
    .sort((a, b) => Boolean(a.project.archived_at) - Boolean(b.project.archived_at) || a.rank - b.rank)
    .map((x) => x.project);
}

/** Find a project or task by name: type, move with the arrow keys, Enter (or a click) opens it. Typed, it finds
 *  their open to-dos too (`todos`, from todoEntries), and picking one calls `onPick(subjectId, todoId)`. With
 *  `onTasks`, the Tasks tab is one of the results, and picking it calls that instead. */
export default function ProjectSearch({ projects, todos = [], statusesById, onPick, onTasks, onClose, title = "Find a project or task" }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const results = useMemo(() => searchResults(withTasksTab(projects, onTasks), todos, query), [projects, todos, onTasks, query]);
  const choose = (p) => (p.id === TASKS_TAB.id ? onTasks() : p.kind === "todo" ? onPick(p.subjectId, p.todoId) : onPick(p.id));
  const current = Math.min(active, results.length - 1);

  useEffect(() => {
    listRef.current?.children[current]?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length) setActive((current + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[current]) choose(results[current]);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <div className="flex items-center gap-2 border-b border-line-strong focus-within:border-text">
        <Search size={15} className="shrink-0 text-muted" aria-hidden="true" />
        <input
          id="project-search"
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls="project-search-results"
          aria-activedescendant={results[current] ? `project-search-${results[current].id}` : undefined}
          aria-label="Project, task or to-do"
          placeholder="Type a project, task or to-do and press Enter"
          autoComplete="off"
          spellCheck={false}
          className="h-10 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
        />
      </div>

      {results.length === 0 ? (
        <p className="py-6 text-center font-serif text-sm italic text-muted">Nothing matches “{query.trim()}”.</p>
      ) : (
        <ul id="project-search-results" ref={listRef} role="listbox" className="mt-1 max-h-[22rem] overflow-y-auto">
          {results.map((p, i) => {
            const Icon = iconFor(p.icon);
            const status = statusesById.get(p.status_id);
            return (
              <li
                key={p.id}
                id={`project-search-${p.id}`}
                role="option"
                aria-selected={i === current}
                onClick={() => choose(p)}
                onMouseMove={() => i !== current && setActive(i)}
                className={`flex cursor-pointer items-center gap-3 border-b border-rule px-1 py-2 ${i === current ? "bg-surface-2" : ""}`}
              >
                {/* A to-do wears its project's (or task's) ink lightly, under the solid tiles of the things themselves */}
                <span
                  className="grid size-7 shrink-0 place-items-center"
                  style={p.kind === "todo" ? { background: tint(p.color, 16), color: inkText(p.color) } : { background: p.color, color: ON_INK }}
                >
                  <Icon size={p.kind === "todo" ? 13 : 15} />
                </span>
                <span className={`min-w-0 flex-1 truncate ${p.kind === "todo" ? "text-[14px]" : "font-serif text-[15px] font-medium"}`}>{p.name}</span>
                {p.kind === "todo" ? (
                  <TodoNote entry={p} />
                ) : p.kind === "tab" ? (
                  <span className="shrink-0 font-serif text-xs italic text-muted">Go to tab</span>
                ) : p.kind === "task" ? (
                  <span className="shrink-0 font-serif text-xs italic text-muted">Task</span>
                ) : p.archived_at ? (
                  <span className="shrink-0 font-serif text-xs italic text-muted">Archived</span>
                ) : (
                  status && (
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted">
                      <span className="size-2" style={{ background: inkFor(status.color) }} aria-hidden="true" />
                      {status.name}
                    </span>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

/** What a to-do found by name belongs to, and whether it is being worked on. */
export function TodoNote({ entry, className = "text-xs" }) {
  return (
    <span className={`flex min-w-0 max-w-[45%] shrink-0 items-center gap-1.5 font-serif italic text-muted ${className}`}>
      {entry.working && <span className="blink-dot size-1.5 shrink-0 rounded-full bg-accent" title="Working on this" aria-label="Working on" />}
      <span className="truncate">in {entry.in}</span>
    </span>
  );
}
