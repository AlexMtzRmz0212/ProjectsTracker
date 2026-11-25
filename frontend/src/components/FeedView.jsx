import { useEffect, useState } from "react";
import { formatDistanceToNowStrict } from "../lib/dates";
import { ArrowUpToLine, CircleDot, CornerDownRight, Layers, ListMinus, ListPlus, Pin, PinOff, Play, Plus, SkipForward, Square } from "lucide-react";
import { usePlanContext } from "../lib/planContext";
import { ON_INK, iconFor, inkFor, inkText, tint } from "../lib/palette";
import { fmtClock } from "../lib/time";
import { Button } from "./Modal";
import ParentTag from "./ParentTag";
import CadenceChip from "./CadenceChip";
import FeedSwipe from "./FeedSwipe";
import { FEED_MODES } from "../lib/feedOrder";
import { loadSort } from "../lib/todoSort";
import { __, _n, useT } from "../i18n";


const SHOWN_TODOS = 5; // more than this and the rest are behind "+N more", which opens the project
const DAY_MS = 86_400_000;
const ROTATION_MODES = ["rotation", "tasks", "projects"];
const daysUntil = (back, today) => Math.max(1, Math.round((back - today) / DAY_MS));
const whenLabel = (days) => (days === 1 ? __("tomorrow") : __("in {n} days", { n: days }));

/**
 * What to work on next: the open projects as a queue, the one idle longest first, each with
 * its open to-dos, which can be added, edited and ticked right here (adding or ticking one
 * counts as working on the project, so it goes to the back too). Starting a timer (from the
 * project or from one of its to-dos) puts the project at the back once time is logged; Skip
 * puts it there straight away. `queue` is [{ project, lastWorked }] in order (see feedQueue),
 * `todosByProject` maps a project id to its open to-dos, `todosById` holds every to-do (to name
 * a sub-to-do's parent) and `todoOps` is the tracker's add / update. `queue` arrives already in the order to
 * show (see orderQueue); `feedOrder` is that order's settings (the mode, the pinned cards) and `onOrder(ids, released)`
 * saves one made by the Sort deck. `waiting` holds the projects kept out of the Feed until their "done every N days"
 * has passed ({ project, backOn }, soonest first) and `today` is the local midnight that opens today.
 */
export default function FeedView({
  queue, waiting = [], today, todosByProject, todosById, todoOps, statusesById, runningId, elapsed, feedOrder, onOrder, onOpen, onStart, onStartTask, onStop, onSkip, onCadence,
}) {
  useT();
  const [sorting, setSorting] = useState(false);
  if (queue.length === 0) {
    const allWaiting = waiting.length > 0;
    return (
      <div className="mx-auto max-w-3xl">
        <div className="grid min-h-[16rem] place-items-center border border-dashed border-line-strong p-6 text-center">
          <div>
            <p className="font-serif text-lg font-semibold">{allWaiting ? __("Nothing due right now") : __("Nothing to work on")}</p>
            <p className="mt-1 text-[13px] text-muted">
              {allWaiting ? __("Every project is waiting out its “done every N days”.") : __("Finished and archived projects don't show up here.")}
            </p>
          </div>
        </div>
        <WaitingFooter waiting={waiting} today={today} onOpen={onOpen} />
      </div>
    );
  }

  const nextId = queue.find(({ project }) => project.id !== runningId)?.project.id;
  const mode = FEED_MODES.find((m) => m.id === feedOrder.mode) ?? FEED_MODES[0];
  // Skip sends a card to the back of the rotation; the "recently edited" order has no back to send it to
  const showSkip = feedOrder.mode !== "edited" && feedOrder.mode !== "recent";

  // The cards of the Sort deck: the projects in the Feed's order, then the open tasks
  const tasksCard = queue.find(({ project }) => project.kind === "tasks")?.project;
  const taskLines = tasksCard ? todosByProject.get(tasksCard.id) ?? [] : [];
  const deck = [
    ...queue
      .filter(({ project }) => project.kind !== "tasks")
      .map(({ project, lastWorked }) => ({
        key: project.id, kind: "project", project, lastWorked, status: statusesById.get(project.status_id), todos: todosByProject.get(project.id) ?? [],
      })),
    ...taskLines
      .filter((todo) => !todo.parent_id)
      .map((todo) => ({ key: todo.id, kind: "task", todo, subs: taskLines.filter((x) => x.parent_id === todo.id).length })),
  ];

  return (
    <div className="pb-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 basis-56 font-serif text-[13px] italic text-muted">
          {__(mode.note)} {feedOrder.displace && ROTATION_MODES.includes(feedOrder.mode) && `${__("A project waits its “done every N days” before it is back on top.")} `}
          {feedOrder.hide && ROTATION_MODES.includes(feedOrder.mode) && `${__("A project stays out of the Feed until its “done every N days” has passed.")} `}
          {__("Pinned cards stay on top.")}
        </p>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          {__("Order")}
          <select
            value={feedOrder.mode}
            onChange={(e) => feedOrder.setMode(e.target.value)}
            className="h-8 border border-line-strong bg-surface px-2 text-[13px] font-semibold text-text outline-none focus:border-text"
          >
            {FEED_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {__(m.label)}
              </option>
            ))}
          </select>
        </label>
        {/* The rotation can count each project's "done every N days": it then waits that long before it is due again, or stays out of the Feed until then */}
        {ROTATION_MODES.includes(feedOrder.mode) && (
          <label
            className="flex items-center gap-1.5 text-xs text-muted"
            title={__("Hide until due: a project stays out of the Feed until its “done every N days” has passed. Plus days: each project also waits its “done every N days”. Direct: by last work.")}
          >
            {__("Rotation")}
            <select
              value={feedOrder.hide ? "hide" : feedOrder.displace ? "days" : "direct"}
              onChange={(e) => feedOrder.setRotation(e.target.value)}
              className="h-8 border border-line-strong bg-surface px-2 text-[13px] font-semibold text-text outline-none focus:border-text"
            >
              <option value="hide">{__("Hide until due")}</option>
              <option value="days">{__("Plus days")}</option>
              <option value="direct">{__("Direct")}</option>
            </select>
          </label>
        )}
        {deck.length > 1 && (
          <button
            onClick={() => setSorting(true)}
            className="inline-flex h-8 items-center gap-1.5 border border-line-strong px-2.5 text-xs font-semibold transition-colors hover:border-text hover:bg-surface-2"
            title={__("Swipe through your projects and tasks to put them in order")}
          >
            <Layers size={13} aria-hidden="true" />{" "}{__("Sort")}</button>
        )}
      </div>
      {sorting && (
        <FeedSwipe
          cards={deck}
          order={queue.map(({ project }) => project.id)}
          onOrder={onOrder}
          todoOps={todoOps}
          onClose={() => setSorting(false)}
        />
      )}
      <ol className="space-y-3">
        {queue.map(({ project, lastWorked }, i) => (
          <FeedCard
            key={project.id}
            position={i + 1}
            project={project}
            lastWorked={lastWorked}
            status={statusesById.get(project.status_id)}
            todos={todosByProject.get(project.id) ?? []}
            todosById={todosById}
            todoOps={todoOps}
            isRunning={project.id === runningId}
            isNext={project.id === nextId}
            pinned={feedOrder.pinned.includes(project.id)}
            onPin={() => feedOrder.togglePin(project.id)}
            canSkip={showSkip && queue.length > 1 && project.id !== runningId}
            elapsed={elapsed}
            onOpen={() => onOpen(project.id)}
            onStart={() => onStart(project.id)}
            onStartTask={onStartTask}
            // Marks the to-do as being worked on; with this project's timer running, its session moves onto that to-do
            onWorkTodo={(todo) => (project.id === runningId ? onStart(project.id, todo.id) : todoOps.update(todo.id, { working: true }))}
            onStop={() => onStop()}
            onSkip={() => onSkip(project.id)}
            onCadence={onCadence}
          />
        ))}
      </ol>
      <WaitingFooter waiting={waiting} today={today} onOpen={onOpen} />
    </div>
  );
}

/** The line under the Feed for the projects kept out of it until their "done every N days" has passed: how many, when
 *  the first is back, and (opened) which ones. */
function WaitingFooter({ waiting, today, onOpen }) {
  useT();
  const [open, setOpen] = useState(false);
  if (waiting.length === 0) return null;
  const when = whenLabel(daysUntil(waiting[0].backOn, today));
  return (
    <div className="mt-3 border-t border-rule pt-2 text-xs text-muted">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="font-serif italic underline-offset-2 transition-colors hover:text-text hover:underline"
      >
        {_n(waiting.length, "{n} project waiting", "{n} projects waiting")}
        {" · "}
        {waiting.length === 1 ? __("back {when}", { when }) : __("next back {when}", { when })}
      </button>
      {open && (
        <ul className="mt-1.5 space-y-0.5">
          {waiting.map(({ project, backOn }) => (
            <li key={project.id} className="flex items-center gap-2">
              <button onClick={() => onOpen(project.id)} title={project.name} className="min-w-0 truncate text-left underline-offset-2 hover:text-text hover:underline">
                {project.name}
              </button>
              <span className="shrink-0 font-serif italic text-faint">{__("back {when}", { when: whenLabel(daysUntil(backOn, today)) })}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FeedCard({
  position, project, lastWorked, status, todos, todosById, todoOps, isRunning, isNext, pinned, onPin, canSkip, elapsed, onOpen, onStart, onStartTask, onWorkTodo, onStop, onSkip, onCadence,
}) {
  useT();
  const { color, name } = project;
  const planCtx = usePlanContext();
  const planned = planCtx?.has("project", project.id);
  // The tasks, as one card: each is timed on its own (not the card), and a new line adds a task
  const isTasks = project.kind === "tasks";
  const Icon = iconFor(project.icon);
  const [expanded, setExpanded] = useState(false);
  // A sub-to-do sits right under its to-do, as in the project's own list; one whose to-do is not open stands alone
  const rows = nestTodos(todos);
  const shown = expanded ? rows : rows.slice(0, SHOWN_TODOS);
  const more = rows.length - shown.length;
  const edge = isRunning ? tint(color, 55) : "var(--line)";

  return (
    // The sides are set one by one: a changing `borderColor` next to `borderLeftColor` makes React warn
    <li
      data-card={project.id} // a find in the Feed scrolls to it
      className={`paper-card relative border border-l-[3px] bg-surface ${position === 1 ? "taped" : ""}`}
      style={{
        borderTopColor: edge,
        borderRightColor: edge,
        borderBottomColor: edge,
        borderLeftColor: color,
        backgroundColor: isRunning ? tint(color, 10) : undefined,
      }}
    >
      <div className="flex items-start gap-2.5 px-3 pt-3">
        <span className="figures w-5 shrink-0 pt-0.5 text-right text-[13px] text-faint" aria-hidden="true">
          {position}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <Icon size={15} strokeWidth={2.25} className="mt-[3px] shrink-0" style={{ color: inkText(color) }} aria-hidden="true" />
            <button
              onClick={onOpen}
              title={name}
              aria-label={isTasks ? __("Open the Tasks tab") : __("Open {name}: to-dos and sessions", { name })}
              className="min-w-0 text-left font-serif text-[16px] font-medium leading-snug underline-offset-4 hover:underline focus-visible:underline"
            >
              <span className="line-clamp-2 break-words">{name}</span>
            </button>
            {isNext && (
              <span className="mt-0.5 shrink-0 border border-line-strong px-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{__("Up next")}</span>
            )}
            {planCtx && project.kind !== "tasks" && (
              <button
                onClick={() => planCtx.toggle("project", project.id)}
                aria-pressed={planned}
                aria-label={planned ? __("Take {name} off the plan", { name }) : __("Add {name} to the plan", { name })}
                title={planned ? __("On the plan: click to take it off") : __("Add to the plan (next up)")}
                className={`ml-auto grid size-6 shrink-0 place-items-center transition-colors hover:bg-surface-2 hover:text-text ${
                  planned ? "text-accent" : "text-faint"
                }`}
              >
                {planned ? <ListMinus size={13} /> : <ListPlus size={13} />}
              </button>
            )}
            <button
              onClick={onPin}
              aria-pressed={pinned}
              aria-label={pinned ? __("Unpin {name}", { name }) : __("Pin {name} to the top of the Feed", { name })}
              title={pinned ? __("Pinned to the top. Click to unpin") : __("Pin to the top of the Feed")}
              className={`${planCtx && project.kind !== "tasks" ? "" : "ml-auto "}grid size-6 shrink-0 place-items-center transition-colors hover:bg-surface-2 hover:text-text ${
                pinned ? "text-accent" : "text-faint"
              }`}
            >
              {pinned ? <Pin size={13} fill="currentColor" /> : <PinOff size={13} />}
            </button>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
            {status && (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2" style={{ background: inkFor(status.color) }} aria-hidden="true" />
                {status.name}
              </span>
            )}
            <span className="font-serif italic">
              {isRunning
                ? __("Working on it now")
                : lastWorked
                  ? __("Last worked {formatDistanceToNowStrict}", { formatDistanceToNowStrict: formatDistanceToNowStrict(lastWorked, { addSuffix: true }) })
                  : __("Never worked")}
            </span>
            {/* "Done every N days" is set from here, not only from the project's edit window */}
            {!isTasks && onCadence && <CadenceChip days={project.cadence_days || 0} onChange={(days) => onCadence(project.id, days)} />}
          </p>
        </div>
      </div>

      {todos.length > 0 ? (
        <ul className="mx-3 mt-2.5 border-t border-rule sm:ml-[2.125rem]">
          {shown.map(({ todo, isSub }, i) => (
            <TodoLine
              key={todo.id}
              todo={todo}
              isSub={isSub}
              todosById={todosById}
              ops={todoOps}
              // In the Tasks card a line can be brought to the top; that puts the card on top of the Feed too
              onTop={
                isTasks && i > 0 && !isSub
                  ? () => {
                      todoOps.moveToTop(todo.id);
                      if (!pinned) onPin();
                    }
                  : undefined
              }
              // ▶ times a task in the Tasks card; in a project it is only the card's own Start, and a to-do is marked
              canStart={isTasks}
              onStart={() => onStartTask(todo)}
              onWork={isTasks ? undefined : () => onWorkTodo(todo)}
            />
          ))}
          {(more > 0 || expanded) && rows.length > SHOWN_TODOS && (
            <li className="py-1.5 pl-1">
              <button
                onClick={() => setExpanded((e) => !e)}
                aria-expanded={expanded}
                className="text-[13px] text-muted underline underline-offset-2 transition-colors hover:text-text"
              >
                {expanded ? __("Show fewer") : _n(more, "+{n} more to-do", "+{n} more to-dos")}
              </button>
            </li>
          )}
        </ul>
      ) : (
        <p className="px-3 py-2 font-serif text-xs italic text-faint sm:pl-[2.125rem]">{__("No open to-dos")}</p>
      )}

      <AddTodo projectId={isTasks ? null : project.id} name={name} noun={isTasks ? "task" : "to-do"} ops={todoOps} />

      <div className="flex items-center justify-end gap-2 px-3 pb-3 pt-2.5">
        {canSkip && (
          <Button
            variant="outline"
            className="h-8 text-xs"
            onClick={onSkip}
            aria-label={__("Skip {name} to the back of the queue", { name })}
            title={__("Move to the back of the queue")}
          >
            <SkipForward size={13} />{" "}{__("Skip")}</Button>
        )}
        {(!isTasks || isRunning) && (
        <button
          onClick={isRunning ? onStop : onStart}
          aria-label={isRunning ? __("Stop {name}", { name }) : __("Start {name}", { name })}
          className={`flex h-8 min-w-[6.5rem] items-center justify-center gap-1.5 border px-3 text-xs font-semibold transition-colors ${
            isRunning ? "" : "border-line-strong hover:border-text hover:bg-surface-2"
          }`}
          style={isRunning ? { background: color, borderColor: color, color: ON_INK } : undefined}
        >
          {isRunning ? (
            <>
              <Square size={10} fill="currentColor" />
              <span className="figures text-[13px]">{fmtClock(elapsed)}</span>
            </>
          ) : (
            <>
              <Play size={11} fill="currentColor" />{" "}{__("Start")}</>
          )}
        </button>
        )}
      </div>
    </li>
  );
}

/** One open to-do: tick it, rename it (saved on blur or Enter; an emptied line goes back to what it was)
 *  or start the project's timer from it. */
function nestTodos(todos) {
  const open = new Set(todos.map((t) => t.id));
  const subsOf = new Map();
  const tops = [];
  for (const todo of todos) {
    if (todo.parent_id && open.has(todo.parent_id)) subsOf.set(todo.parent_id, [...(subsOf.get(todo.parent_id) ?? []), todo]);
    else tops.push(todo);
  }
  return tops.flatMap((todo) => [{ todo, isSub: false }, ...(subsOf.get(todo.id) ?? []).map((sub) => ({ todo: sub, isSub: true }))]);
}

function TodoLine({ todo, isSub = false, todosById, ops, canStart, onTop, onStart, onWork }) {
  useT();
  const [draft, setDraft] = useState(todo.text);
  useEffect(() => setDraft(todo.text), [todo.text]);

  const commit = () => {
    const text = draft.trim();
    if (!text || text === todo.text) return setDraft(todo.text);
    ops.update(todo.id, { text });
  };

  return (
    <li className={`flex items-center gap-2.5 border-b border-rule ${isSub ? "pl-7" : "pl-1"}`}>
      {isSub && <CornerDownRight size={12} className="-ml-4 shrink-0 text-faint" aria-hidden="true" />}
      <input
        type="checkbox"
        checked={false}
        onChange={() => ops.update(todo.id, { done: true })}
        aria-label={__("Mark \"{text}\" done", { text: todo.text })}
        className="size-4 shrink-0 cursor-pointer accent-(--text)"
      />
      {!isSub && <ParentTag todo={todo} todosById={todosById} className="max-sm:max-w-[6rem]" />}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            setDraft(todo.text);
            e.currentTarget.blur();
          }
        }}
        maxLength={250}
        aria-label={__("To-do")}
        className="h-9 min-w-0 flex-1 bg-transparent text-[14px] outline-none focus:bg-surface-2"
      />
      {onTop && (
        <button
          onClick={onTop}
          aria-label={__("Put \"{text}\" first", { text: todo.text })}
          title={__("Put first: top of the list, and the Tasks card on top of the Feed")}
          className="grid size-8 shrink-0 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <ArrowUpToLine size={13} />
        </button>
      )}
      {onWork && (
        <button
          onClick={todo.working_since ? () => ops.update(todo.id, { working: false }) : onWork}
          aria-pressed={Boolean(todo.working_since)}
          aria-label={todo.working_since ? __("Stop marking \"{text}\" as being worked on", { text: todo.text }) : __("Work on \"{text}\"", { text: todo.text })}
          title={todo.working_since ? __("Working on this. Click to unmark") : __("Mark as working on")}
          className={`grid size-8 shrink-0 place-items-center transition-colors hover:bg-surface-2 ${todo.working_since ? "text-accent" : "text-muted hover:text-text"}`}
        >
          <CircleDot size={13} className={todo.working_since ? "blink-dot" : undefined} aria-hidden="true" />
        </button>
      )}
      {canStart && (
        <button
          onClick={onStart}
          aria-label={__("Work on \"{text}\"", { text: todo.text })}
          title={__("Work on this")}
          className="grid size-8 shrink-0 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <Play size={12} fill="currentColor" />
        </button>
      )}
    </li>
  );
}

/** The line under a card's to-dos for a new one. */
function AddTodo({ projectId, name, noun = "to-do", ops }) {
  useT();
  const [draft, setDraft] = useState("");

  const add = async (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    // The card lists to-dos in their stored order, so with the list on Manual a new one goes to the front, where it shows
    const position = loadSort(projectId ? "project" : "tasks") === "manual" ? "top" : "bottom";
    if (!(await ops.add(projectId, text, null, position))) setDraft(text);
  };

  return (
    <form onSubmit={add} className="mx-3 flex items-center gap-2 border-b border-rule focus-within:border-text sm:ml-[2.125rem]">
      <Plus size={14} className="shrink-0 text-muted" aria-hidden="true" />
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={250}
        placeholder={noun === "task" ? __("Add a task and press Enter") : __("Add a to-do and press Enter")}
        aria-label={projectId === null ? __("New task") : __("New to-do for {name}", { name })}
        className="h-9 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
      />
    </form>
  );
}
