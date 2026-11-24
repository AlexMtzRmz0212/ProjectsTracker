import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "../lib/dates";
import { Bookmark, Check, X } from "lucide-react";
import { taskKey } from "../api";
import { iconFor, inkText } from "../lib/palette";
import { fmtOpen } from "./OpenItemsBar";
import { __, useT } from "../i18n";

/**
 * Every to-do marked as being worked on, in one menu to look back over: grouped by the project it belongs to,
 * with the ones that are tasks (to-dos with no project) listed together. Clicking one opens its project (or
 * the task) in the side peek. Each can be ticked off or let go of from here. Newest first.
 */
export default function WorkingMenu({ todos, projectsById, todoOps, now, onOpen }) {
  useT();
  const [open, setOpen] = useState(false);
  const root = useRef(null);

  const { groups, tasks, count } = useMemo(() => {
    const byId = new Map(todos.map((x) => [x.id, x]));
    const since = (x) => new Date(x.working_since).getTime();
    const projectGroups = new Map();
    const taskItems = [];
    for (const todo of todos) {
      if (todo.done || !todo.working_since) continue;
      if (todo.project_id) {
        const project = projectsById.get(todo.project_id);
        if (!project) continue;
        if (!projectGroups.has(project.id)) projectGroups.set(project.id, { project, items: [] });
        projectGroups.get(project.id).items.push(todo);
        continue;
      }
      // A task is a to-do with no project, and its sub-to-dos belong to it: open the top one
      let top = todo;
      while (top.parent_id && byId.has(top.parent_id)) top = byId.get(top.parent_id);
      const subject = projectsById.get(taskKey(top.id));
      if (subject) taskItems.push({ todo, subject, parent: top === todo ? null : top });
    }
    const groups = [...projectGroups.values()]
      .map((g) => ({ ...g, items: g.items.sort((a, b) => since(b) - since(a)) }))
      .sort((a, b) => since(b.items[0]) - since(a.items[0]));
    taskItems.sort((a, b) => since(b.todo) - since(a.todo));
    return { groups, tasks: taskItems, count: groups.reduce((n, g) => n + g.items.length, 0) + taskItems.length };
  }, [todos, projectsById]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !root.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (subjectId) => {
    setOpen(false);
    onOpen(subjectId);
  };

  // The button is a bookmark: a ribbon with a V cut into its foot, tinted with the accent while something is being worked on
  return (
    <div ref={root} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="true"
        title={__("Working on")}
        className={`flex h-12 w-9 flex-col items-center gap-0.5 pt-2 text-[13px] font-semibold transition-colors [clip-path:polygon(0_0,100%_0,100%_100%,50%_78%,0_100%)] ${
          count > 0
            ? "bg-[color-mix(in_srgb,var(--accent)_28%,var(--surface-2))] text-text hover:bg-[color-mix(in_srgb,var(--accent)_38%,var(--surface-2))]"
            : "bg-[color-mix(in_srgb,var(--text)_12%,var(--surface))] text-muted hover:text-text"
        } ${open ? "text-text" : ""}`}
      >
        <Bookmark size={14} className={count > 0 ? "text-accent" : ""} fill={count > 0 ? "currentColor" : "none"} aria-hidden="true" />
        <span className="sr-only">{__("Working on")}</span>
        <span className="figures text-xs font-semibold leading-none">{count}</span>
      </button>

      {open && (
        <div
          role="region"
          aria-label={__("To-dos being worked on")}
          className="absolute right-0 top-full z-50 mt-3 max-h-[min(34rem,calc(100dvh-6rem))] w-[min(26rem,calc(100vw-1.5rem))] overflow-y-auto border border-line-strong bg-surface shadow-[0_6px_24px_rgb(0_0_0/0.25)]"
        >
          {count === 0 ? (
            <p className="px-4 py-5 text-center text-[13px] text-muted">{__("Nothing marked as being worked on. Mark a to-do with the dot beside it and it is listed here.")}</p>
          ) : (
            <>
              {groups.map(({ project, items }) => (
                <Section key={project.id} subject={project} onOpen={() => pick(project.id)}>
                  {items.map((todo) => (
                    <Row key={todo.id} todo={todo} now={now} todoOps={todoOps} onOpen={() => pick(project.id)} />
                  ))}
                </Section>
              ))}
              {tasks.length > 0 && (
                <section className="border-b border-rule last:border-b-0">
                  <h3 className="px-4 pb-1 pt-3 font-serif text-xs font-semibold italic text-muted">{__("Tasks")}</h3>
                  <ul>
                    {tasks.map(({ todo, subject, parent }) => (
                      <Row key={todo.id} todo={todo} parent={parent} now={now} todoOps={todoOps} onOpen={() => pick(subject.id)} />
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ subject, onOpen, children }) {
  useT();
  const Icon = iconFor(subject.icon);
  return (
    <section className="border-b border-rule last:border-b-0">
      <h3 className="px-4 pb-1 pt-3">
        <button onClick={onOpen} className="flex max-w-full items-center gap-2 text-left hover:underline" title={__("Open {name}", { name: subject.name })}>
          <Icon size={14} style={{ color: inkText(subject.color) }} className="shrink-0" aria-hidden="true" />
          <span className="truncate font-serif text-[15px] font-semibold">{subject.name}</span>
        </button>
      </h3>
      <ul>{children}</ul>
    </section>
  );
}

function Row({ todo, parent = null, now, todoOps, onOpen }) {
  useT();
  const since = new Date(todo.working_since);
  const act = "grid size-7 shrink-0 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text";
  return (
    <li className="group flex items-center gap-1 pl-4 pr-2">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-baseline gap-2 py-1.5 text-left text-[13px]" title={__("Working on this since {format}", { format: format(since, "EEE d MMM, HH:mm") })}>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{todo.text}</span>
          {parent && <span className="block truncate font-serif text-xs italic text-muted">{__("in {name}", { name: parent.text })}</span>}
        </span>
        <span className="figures shrink-0 font-serif text-xs italic text-muted">{fmtOpen((now - since) / 1000)}</span>
      </button>
      <button onClick={() => todoOps.update(todo.id, { done: true })} className={act} aria-label={__("Mark \"{text}\" done", { text: todo.text })} title={__("Mark done")}>
        <Check size={14} />
      </button>
      <button
        onClick={() => todoOps.update(todo.id, { working: false })}
        className={act}
        aria-label={__("Stop marking \"{text}\" as being worked on", { text: todo.text })}
        title={__("No longer working on it")}
      >
        <X size={14} />
      </button>
    </li>
  );
}
