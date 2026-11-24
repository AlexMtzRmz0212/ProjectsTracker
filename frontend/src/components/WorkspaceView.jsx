import { useMemo, useState } from "react";
import { Check, ChevronDown, CircleDot, ClipboardPaste, GripVertical, ListChecks, ListMinus, ListPlus, ListTodo, Play, Search, Sparkles, Square, Target, X } from "lucide-react";
import { useReorder } from "../hooks/useReorder";
import PlanAiPanel from "./PlanAiPanel";
import { usePlanContext } from "../lib/planContext";
import { dayState, entriesByDay, dayKey, streakOf } from "../lib/habits";
import { loadExpanded, saveExpanded } from "../lib/foldState";
import { TASK_INK, iconFor, inkText } from "../lib/palette";
import { __, _n, useT } from "../i18n";

const LIMIT = 6; // rows a group shows before "Show all"
const FOLD_SCOPE = "workspace"; // where which projects, tasks and to-dos are opened is remembered
const NEXT_SCOPE = "workspace-next"; // the same for the ones in "Next up"

const isOpenTodo = (x) => !x.done && !x.cancelled_at;

/**
 * The Workspace tab: one place to choose what to work on, from everything that can be worked on. Each row has a
 * Start button that does what starting it does elsewhere:
 * - what is already being worked on (to-dos marked so) comes first;
 * - projects and tasks start their timer (a pomodoro goes with it if none is going), and so does a to-do;
 * - habits have no timer: starting one starts a focus (a pomodoro) with its name as what it is for.
 * Projects and Tasks sit side by side. A project holds its open to-dos, and a to-do its sub-to-dos; a task holds its
 * sub-tasks. They start folded and open with the arrow (remembered). The box above searches all of it: Enter opens the
 * first project or task it finds in the side peek (`onOpen(subjectId)`).
 *
 * "Next up" at the top is the plan: what to do next, in the order to do it, dragged into place. A project on it opens
 * (the arrow) to its to-dos and their sub-to-dos, a task to its sub-tasks, and each to-do, sub-to-do, task and sub-task
 * there can be ticked done. Anything below (and a to-do's
 * menu, a project's peek, a Feed card) can be added to it with the list button (`usePlanContext`). `plan` is its rows,
 * [{ planId, kind, name, context?, why?, icon?, color?, running, onStart }], `onPlanReorder(ids)` and `onPlanRemove(planId)`.
 * "Copy for AI" copies everything that could be worked on as a prompt for an AI to say what to do first (`onCopyForAi`,
 * which resolves to whether it worked); "Paste AI reply" takes its answer back: `resolvePlanId(id)` says what one of the
 * prompt's ids is and `onPlanArrange(picks)` puts what the AI chose at the front of the plan (see PlanAiPanel).
 * `todos` is every to-do and `todoOps` what changes one.
 */
export default function WorkspaceView({
  working, projects, tasks, habits, todos = [], todoOps, runningId, timedTodoId = null, focusLabel, today, onStartSubject, onStartTodo, onStartChore, onStop, onOpen,
  plan = [], onPlanReorder, onPlanRemove, onCopyForAi, resolvePlanId, onPlanArrange,
}) {
  useT();
  const planCtx = usePlanContext();
  const planFor = (kind, ref) => (planCtx ? { on: planCtx.has(kind, ref), onToggle: () => planCtx.toggle(kind, ref) } : null);
  const [copied, setCopied] = useState(false);
  const [pasting, setPasting] = useState(false);
  const copyForAi = async () => {
    if (!(await onCopyForAi?.())) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const has = (text) => !q || text.toLowerCase().includes(q);

  // Which parents are opened: everything starts folded
  const [expanded, setExpanded] = useState(() => loadExpanded(FOLD_SCOPE));
  const [expandedNext, setExpandedNext] = useState(() => loadExpanded(NEXT_SCOPE));
  const foldIn = (setter, scope) => (id) =>
    setter((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      saveExpanded(scope, next, [...todos.map((x) => x.id), ...projects.map((p) => p.id), ...tasks.map((p) => p.id), ...plan.map((r) => r.planId)]);
      return next;
    });
  const toggle = foldIn(setExpanded, FOLD_SCOPE);
  const toggleNext = foldIn(setExpandedNext, NEXT_SCOPE);
  // Where a to-do's row gets its fold from, and whether it has a tick: only "Next up" ticks
  const inTree = { open: expanded, toggle, ticks: false };
  const inNext = { open: expandedNext, toggle: toggleNext, ticks: true };

  // The open to-dos as parents with their sub-to-dos: { todo, subs }
  const { byProject, byId, subsOf } = useMemo(() => {
    const open = todos.filter(isOpenTodo);
    const ids = new Set(open.map((x) => x.id));
    const subsOf = new Map();
    for (const x of open) if (x.parent_id && ids.has(x.parent_id)) subsOf.set(x.parent_id, [...(subsOf.get(x.parent_id) ?? []), x]);
    const byProject = new Map();
    for (const x of open) {
      if (!x.project_id || (x.parent_id && ids.has(x.parent_id))) continue;
      byProject.set(x.project_id, [...(byProject.get(x.project_id) ?? []), { todo: x, subs: subsOf.get(x.id) ?? [] }]);
    }
    return { byProject, byId: new Map(open.map((x) => [x.id, x])), subsOf };
  }, [todos]);

  /** What of a parent's to-dos the search keeps: all of them when the parent itself matches, else the ones that match
   *  (a to-do that matches keeps its sub-to-dos, one only a sub-to-do matches keeps just that). */
  const keep = (nodes, ownerMatches) => {
    if (!q || ownerMatches) return nodes;
    return nodes
      .map((n) => (has(n.todo.text) ? n : { ...n, subs: n.subs.filter((s) => has(s.text)) }))
      .filter((n) => has(n.todo.text) || n.subs.length > 0);
  };

  const projectRows = projects
    .map((p) => {
      const own = has(p.name);
      return { subject: p, nodes: keep(byProject.get(p.id) ?? [], own), show: own };
    })
    .filter((r) => r.show || r.nodes.length > 0);
  const taskRows = tasks
    .map((p) => {
      const own = has(p.name);
      const subs = subsOf.get(p.todoId) ?? [];
      return { subject: p, nodes: keep(subs.map((s) => ({ todo: s, subs: [] })), own), show: own };
    })
    .filter((r) => r.show || r.nodes.length > 0);
  const workingRows = working.filter((w) => has(w.todo.text) || has(w.context));
  const habitRows = habits.filter((h) => has(h.name));
  const planRows = plan.filter((r) => has(r.name) || has(r.context ?? ""));
  const nothing = workingRows.length + projectRows.length + taskRows.length + habitRows.length === 0;

  const key = dayKey(today);
  const focusing = (label) => focusLabel === label;

  // Enter on a search opens the first project or task it found (or what a found to-do is in) in the side peek
  const openFirst = () => {
    const first = projectRows[0]?.subject.id ?? taskRows[0]?.subject.id ?? workingRows[0]?.subjectId;
    if (first) onOpen?.(first);
  };

  const done = (todo) => ({ label: __("Mark \"{text}\" done", { text: todo.text }), onTick: () => todoOps?.update(todo.id, { done: true }) });
  const startTodoAction = (todo) =>
    timedTodoId === todo.id
      ? { label: __("Stop"), icon: Square, onClick: onStop }
      : { label: __("Start"), icon: Play, onClick: () => onStartTodo(todo) };

  /** A to-do row, with its sub-to-dos under it. */
  const todoNode = ({ todo, subs }, depth, ctx = inTree) => {
    const folded = subs.length > 0 && !ctx.open.has(todo.id) && !(q && ctx === inTree && subs.some((s) => has(s.text)));
    return (
      <Row
        key={todo.id}
        depth={depth}
        tick={ctx.ticks && todoOps ? done(todo) : null}
        icon={todo.working_since ? <CircleDot size={14} className="blink-dot text-accent" aria-hidden="true" /> : null}
        name={todo.text}
        meta={subs.length > 0 ? _n(subs.length, "{n} sub-to-do", "{n} sub-to-dos") : null}
        running={timedTodoId === todo.id}
        plan={ctx.ticks ? null : planFor("todo", todo.id)}
        action={startTodoAction(todo)}
        fold={subs.length > 0 ? { folded, onToggle: () => ctx.toggle(todo.id) } : null}
      >
        {subs.map((s) => todoNode({ todo: s, subs: [] }, depth + 1, ctx))}
      </Row>
    );
  };

  /** Whether a parent shows what is in it: it was opened, or the search is looking inside it. */
  const isOpen = (id, nodes, ownMatch) => expanded.has(id) || Boolean(q && !ownMatch && nodes.length > 0);

  return (
    <section className="flex h-full flex-col">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-serif text-[17px] font-semibold">{__("Workspace")}</h2>
        <span className="font-serif text-xs italic text-muted">{__("what to work on")}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {onCopyForAi && (
            <button
              onClick={copyForAi}
              className="inline-flex h-8 items-center gap-1.5 border border-line-strong px-2.5 text-xs font-semibold transition-colors hover:border-text hover:bg-surface-2"
              title={__("Copy every project, to-do, task and habit as a prompt, to ask an AI what to do first")}
            >
              {copied ? <Check size={13} aria-hidden="true" /> : <Sparkles size={13} aria-hidden="true" />}
              {copied ? __("Copied") : __("Copy for AI")}
            </button>
          )}
          {onPlanArrange && resolvePlanId && (
            <button
              onClick={() => setPasting((p) => !p)}
              aria-pressed={pasting}
              className={`inline-flex h-8 items-center gap-1.5 border px-2.5 text-xs font-semibold transition-colors hover:border-text hover:bg-surface-2 ${pasting ? "border-text bg-surface-2" : "border-line-strong"}`}
              title={__("Paste an AI's answer to line up what to do first")}
            >
              <ClipboardPaste size={13} aria-hidden="true" />
              {__("Paste AI reply")}
            </button>
          )}
        </div>
      </div>
      <p className="mt-0.5 mb-3 text-[13px] text-muted">{__("Pick one: projects, tasks and to-dos start their timer, and habits start a pomodoro for them.")}</p>

      {pasting && onPlanArrange && resolvePlanId && <PlanAiPanel resolve={resolvePlanId} onApply={onPlanArrange} onClose={() => setPasting(false)} />}

      <label className="mb-2 flex h-9 shrink-0 items-center gap-2 border border-line-strong px-2.5 focus-within:border-text">
        <Search size={14} className="shrink-0 text-muted" aria-hidden="true" />
        <input
          id="workspace-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            openFirst();
          }}
          placeholder={__("Search what to work on")}
          aria-label={__("Search what to work on")}
          maxLength={120}
          className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
        />
      </label>

      <div data-scroll className="@container min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {planCtx && (plan.length > 0 || !q) && (
          <NextUp
            rows={planRows}
            empty={plan.length === 0}
            onReorder={onPlanReorder}
            onRemove={onPlanRemove}
            onStop={onStop}
            kidsOf={(r) => (r.kind === "project" ? byProject.get(r.ref) ?? [] : r.kind === "todo" ? (subsOf.get(r.ref) ?? []).map((x) => ({ todo: x, subs: [] })) : [])}
            tickOf={(r) => (r.kind === "todo" && todoOps && byId.get(r.ref) ? done(byId.get(r.ref)) : null)}
            open={expandedNext}
            onFold={toggleNext}
            renderKid={(node) => todoNode(node, 2, inNext)}
          />
        )}

        <Group title={__("Being worked on")} icon={CircleDot} rows={workingRows}>
          {(w) => {
            const running = timedTodoId === w.todo.id;
            return (
              <Row
                key={w.todo.id}
                tick={todoOps ? done(w.todo) : null}
                icon={<CircleDot size={14} className="blink-dot text-accent" aria-hidden="true" />}
                name={w.todo.text}
                meta={w.context}
                running={running}
                plan={planFor("todo", w.todo.id)}
                action={startTodoAction(w.todo)}
              />
            );
          }}
        </Group>

        {/* Projects and tasks, side by side where there is room */}
        <div className="grid gap-x-8 @2xl:grid-cols-2">
          <Group title={__("Projects")} icon={ListChecks} rows={projectRows}>
            {({ subject: p, nodes }) => {
              const Icon = iconFor(p.icon);
              const running = runningId === p.id;
              const count = nodes.reduce((n, x) => n + 1 + x.subs.length, 0);
              return (
                <Row
                  key={p.id}
                  icon={<Icon size={14} style={{ color: inkText(p.color) }} aria-hidden="true" />}
                  name={p.name}
                  meta={count > 0 ? _n(count, "{n} open", "{n} open") : null}
                  running={running}
                  plan={planFor("project", p.id)}
                  action={running ? { label: __("Stop"), icon: Square, onClick: onStop } : { label: __("Start"), icon: Play, onClick: () => onStartSubject(p.id) }}
                  fold={nodes.length > 0 ? { folded: !isOpen(p.id, nodes, has(p.name)), onToggle: () => toggle(p.id) } : null}
                >
                  {nodes.map((n) => todoNode(n, 1))}
                </Row>
              );
            }}
          </Group>

          <Group title={__("Tasks")} icon={ListChecks} rows={taskRows}>
            {({ subject: p, nodes }) => {
              const Icon = iconFor(p.icon);
              const running = runningId === p.id;
              return (
                <Row
                  key={p.id}
                  icon={<Icon size={14} style={{ color: TASK_INK }} aria-hidden="true" />}
                  name={p.name}
                  meta={nodes.length > 0 ? _n(nodes.length, "{n} sub-task", "{n} sub-tasks") : null}
                  running={running}
                  plan={planFor("todo", p.todoId)}
                  action={running ? { label: __("Stop"), icon: Square, onClick: onStop } : { label: __("Start"), icon: Play, onClick: () => onStartSubject(p.id) }}
                  fold={nodes.length > 0 ? { folded: !isOpen(p.id, nodes, has(p.name)), onToggle: () => toggle(p.id) } : null}
                >
                  {nodes.map((n) => todoNode(n, 1))}
                </Row>
              );
            }}
          </Group>
        </div>

        <Group title={__("Habits")} icon={Target} rows={habitRows} order={(h) => (entriesByDay(h).has(key) ? 1 : 0)}>
          {(h) => {
            const state = dayState(h, entriesByDay(h).get(key));
            const streak = streakOf(h, today);
            return (
              <Row
                key={h.id}
                icon={<Target size={14} className={state === "done" ? "text-accent-2" : "text-muted"} aria-hidden="true" />}
                name={h.name}
                meta={[state === "done" ? __("done today") : state === "none" ? __("not logged today") : state === "skip" ? __("skipped today") : __("missed today"), streak > 0 ? __("{n} day streak", { n: streak }) : null]
                  .filter(Boolean)
                  .join(", ")}
                running={focusing(h.name)}
                plan={planFor("habit", h.id)}
                action={{ label: focusing(h.name) ? __("Focusing") : __("Start"), icon: Play, onClick: () => onStartChore(h.name), disabled: focusing(h.name) }}
              />
            );
          }}
        </Group>

        {nothing && <p className="py-4 font-serif text-sm italic text-muted">{__("Nothing matches “{query}”.", { query: query.trim() })}</p>}
      </div>
    </section>
  );
}

/** A titled group of rows; shows the first few, with the rest a click away. `order(row)` ranks rows (lower first). */
function Group({ title, icon: Icon, rows, order, children }) {
  useT();
  const [all, setAll] = useState(false);
  if (rows.length === 0) return null;
  const sorted = order ? [...rows].sort((a, b) => order(a) - order(b)) : rows;
  const shown = all ? sorted : sorted.slice(0, LIMIT);
  return (
    <section className="mb-4 min-w-0 self-start">
      <h3 className="flex items-center gap-1.5 border-b border-rule py-1 font-serif text-xs italic text-muted">
        <Icon size={12} aria-hidden="true" /> {title} <span className="figures not-italic">{rows.length}</span>
      </h3>
      <ul>{shown.map((r) => children(r))}</ul>
      {rows.length > LIMIT && (
        <button
          onClick={() => setAll((a) => !a)}
          className="mt-1 text-[13px] text-muted underline underline-offset-2 transition-colors hover:text-text"
        >
          {all ? __("Show fewer") : __("Show all {length}", { length: rows.length })}
        </button>
      )}
    </section>
  );
}

/**
 * One row: an arrow to open what is under it (`fold` is { folded, onToggle }; `children` are the rows under it, shown when
 * it is open), a tick to finish it (`tick` is { label, onTick }), what it is, the plan button and its action. `depth`
 * indents the rows under a parent.
 */
function Row({ icon, name, meta, running = false, action, plan = null, fold = null, tick = null, depth = 0, children = null }) {
  useT();
  const Action = action.icon;
  return (
    <li>
      <div
        className={`flex min-h-10 items-center gap-1.5 border-b border-rule ${running ? "bg-[color-mix(in_srgb,var(--accent)_7%,transparent)] shadow-[inset_3px_0_0_var(--accent)]" : ""}`}
        style={depth > 0 ? { paddingLeft: depth * 22 } : undefined}
      >
        {fold ? (
          <button
            onClick={fold.onToggle}
            aria-expanded={!fold.folded}
            aria-label={fold.folded ? __("Show what is in \"{name}\"", { name }) : __("Hide what is in \"{name}\"", { name })}
            title={fold.folded ? __("Show what is in it") : __("Hide what is in it")}
            className="grid size-6 shrink-0 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <ChevronDown size={15} className={`transition-transform ${fold.folded ? "-rotate-90" : ""}`} aria-hidden="true" />
          </button>
        ) : (
          <span className="size-6 shrink-0" aria-hidden="true" />
        )}
        {tick && (
          <input
            type="checkbox"
            checked={false}
            onChange={tick.onTick}
            aria-label={tick.label}
            title={__("Mark done")}
            className="size-4 shrink-0 cursor-pointer accent-(--text)"
          />
        )}
        {icon && <span className="grid size-5 shrink-0 place-items-center">{icon}</span>}
        <span className="min-w-0 flex-1 py-1.5 text-[14px]">
          <span className="break-words">{name}</span>
          {meta && <span className="ml-2 font-serif text-xs italic text-muted">{meta}</span>}
        </span>
        {plan && <PlanButton plan={plan} name={name} />}
        <button
          onClick={action.onClick}
          disabled={action.disabled}
          className={`mr-1 inline-flex h-8 shrink-0 items-center gap-1.5 border px-2.5 text-xs font-semibold transition-colors disabled:pointer-events-none ${
            running ? "border-accent text-accent" : "border-line-strong hover:border-text hover:bg-surface-2"
          }`}
        >
          <Action size={11} fill="currentColor" aria-hidden="true" /> {action.label}
        </button>
      </div>
      {fold && !fold.folded && children && <ul>{children}</ul>}
    </li>
  );
}

/** Add something to the plan, or take it off: a list button on a row. */
function PlanButton({ plan, name }) {
  const Icon = plan.on ? ListMinus : ListPlus;
  const label = plan.on ? __("Take \"{name}\" off the plan", { name }) : __("Add \"{name}\" to the plan", { name });
  return (
    <button
      onClick={plan.onToggle}
      aria-label={label}
      aria-pressed={plan.on}
      title={plan.on ? __("On the plan: click to take it off") : __("Add to the plan (next up)")}
      className={`grid size-8 shrink-0 place-items-center transition-colors hover:bg-surface-2 ${plan.on ? "text-accent" : "text-muted hover:text-text"}`}
    >
      <Icon size={15} aria-hidden="true" />
    </button>
  );
}

/** The plan: what to do next, in the order to do it. Drag a row's handle (or use the arrow keys on it) to reorder. */
function NextUp({ rows, empty, onReorder, onRemove, onStop, kidsOf, tickOf, open, onFold, renderKid }) {
  useT();
  const order = useReorder(rows.map((r) => r.planId), (ids) => onReorder?.(ids));
  return (
    <section className="mb-4">
      <h3 className="flex items-center gap-1.5 border-b border-rule py-1 font-serif text-xs italic text-muted">
        <ListTodo size={12} aria-hidden="true" /> {__("Next up")} <span className="figures not-italic">{rows.length}</span>
      </h3>
      {empty ? (
        <p className="py-3 font-serif text-sm italic text-muted">
          {__("Nothing lined up yet. Add things with the list button on a row below, or “Add to plan” in a to-do's menu.")}
        </p>
      ) : (
        <ul className={order.held ? "select-none" : ""}>
          {rows.map((r, i) => {
            const row = order.rowProps(i);
            const Icon = r.kind === "project" ? iconFor(r.icon) : r.kind === "habit" ? Target : ListChecks;
            const kids = kidsOf(r);
            const opened = kids.length > 0 && open.has(r.planId);
            const tick = tickOf(r);
            return (
              <li key={r.planId} {...row} className={`border-b border-rule ${row.className ?? "bg-surface"}`}>
                <div className={`flex min-h-10 items-center gap-1.5 ${r.running ? "shadow-[inset_3px_0_0_var(--accent)]" : ""}`}>
                <button
                  {...order.gripProps(r.planId, i)}
                  aria-label={__("Move \"{name}\": drag, or use the up and down arrow keys", { name: r.name })}
                  title={__("Drag to reorder")}
                  className={`grid h-8 w-6 shrink-0 touch-none place-items-center text-faint transition-colors hover:text-text ${
                    order.held === r.planId ? "cursor-grabbing text-text" : "cursor-grab"
                  }`}
                >
                  <GripVertical size={15} />
                </button>
                <span className="figures w-4 shrink-0 text-right text-xs text-faint" aria-hidden="true">{i + 1}</span>
                {kids.length > 0 ? (
                  <button
                    onClick={() => onFold(r.planId)}
                    aria-expanded={opened}
                    aria-label={opened ? __("Hide what is in \"{name}\"", { name: r.name }) : __("Show what is in \"{name}\"", { name: r.name })}
                    title={opened ? __("Hide what is in it") : __("Show what is in it")}
                    className="grid size-6 shrink-0 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
                  >
                    <ChevronDown size={15} className={`transition-transform ${opened ? "" : "-rotate-90"}`} aria-hidden="true" />
                  </button>
                ) : (
                  <span className="size-6 shrink-0" aria-hidden="true" />
                )}
                {tick && (
                  <input type="checkbox" checked={false} onChange={tick.onTick} aria-label={tick.label} title={__("Mark done")} className="size-4 shrink-0 cursor-pointer accent-(--text)" />
                )}
                <span className="grid size-5 shrink-0 place-items-center">
                  <Icon size={14} style={r.color ? { color: inkText(r.color) } : undefined} className={r.color ? "" : "text-muted"} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 py-1.5 text-[14px]">
                  <span className="break-words">{r.name}</span>
                  {r.context && <span className="ml-2 font-serif text-xs italic text-muted">{r.context}</span>}
                  {r.why && <span className="block break-words font-serif text-xs italic text-muted">{r.why}</span>}
                </span>
                <button
                  onClick={r.running ? onStop : r.onStart}
                  className={`inline-flex h-8 shrink-0 items-center gap-1.5 border px-2.5 text-xs font-semibold transition-colors ${
                    r.running ? "border-accent text-accent" : "border-line-strong hover:border-text hover:bg-surface-2"
                  }`}
                >
                  {r.running ? <Square size={11} fill="currentColor" aria-hidden="true" /> : <Play size={11} fill="currentColor" aria-hidden="true" />}
                  {r.running ? __("Stop") : __("Start")}
                </button>
                <button
                  onClick={() => onRemove?.(r.planId)}
                  aria-label={__("Take \"{name}\" off the plan", { name: r.name })}
                  title={__("Take it off the plan")}
                  className="mr-1 grid size-8 shrink-0 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
                >
                  <X size={15} aria-hidden="true" />
                </button>
                </div>
                {opened && <ul>{kids.map((node) => renderKid(node))}</ul>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
