import { useEffect, useRef, useState } from "react";
import { formatDistanceToNowStrict } from "../lib/dates";
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpToLine, CalendarPlus, CircleDot, Clock, EyeOff, Hand, Info, Pencil, CornerDownRight, Layers, ListMinus, ListPlus, Pin, PinOff, Play, Plus, SkipForward, Square, StickyNote } from "lucide-react";
import { usePlanContext } from "../lib/planContext";
import { ON_INK, TASK_INK, iconFor, inkFor, inkText, tint } from "../lib/palette";
import { useTasksPad } from "../hooks/useTasksPad";
import { useFeedHelp } from "../hooks/useFeedHelp";
import { fmtClock } from "../lib/time";
import { Button } from "./Modal";
import ParentTag from "./ParentTag";
import CadenceChip from "./CadenceChip";
import FeedSwipe from "./FeedSwipe";
import FeedPlayoff from "./FeedPlayoff";
import SortChooser from "./SortChooser";
import { FEED_MODES, joinMode, splitMode, supportsDays, touchedAt } from "../lib/feedOrder";
import { loadSort } from "../lib/todoSort";
import { __, _n, N_ } from "../i18n";

// What each cadence choice does; shown under the control when the descriptions are asked for, and as its hover text
const CADENCE_NOTES = {
  hide: N_("A project stays out of the Feed until its “done every N days” has passed."),
  days: N_("A project waits its “done every N days” before it is back on top."),
  direct: N_("“Done every N days” is ignored: projects follow the order alone."),
};


const SHOWN_TODOS = 5; // more than this and the rest are behind "+N more", which opens the project
const DAY_MS = 86_400_000;
const daysUntil = (back, today) => Math.max(1, Math.round((back - today) / DAY_MS));
const whenLabel = (days) => (days === 1 ? __("tomorrow") : __("in {n} days", { n: days }));

/**
 * What to work on next: the open projects as a queue, the one idle longest first, each with
 * its open to-dos, which can be added, edited and ticked right here (ticking one
 * counts as working on the project, so it goes to the back too). Starting a timer (from the
 * project or from one of its to-dos) puts the project at the back once time is logged; Skip
 * puts it there straight away. The Tasks are not one of the cards: they are a notepad above the list, pulled
 * down to see them or tucked away to see only the projects (see TasksPad).
 * `queue` is [{ project, lastWorked }] in order (see feedQueue),
 * `todosByProject` maps a project id to its open to-dos, `todosById` holds every to-do (to name
 * a sub-to-do's parent) and `todoOps` is the tracker's add / update. `queue` arrives already in the order to
 * show (see orderQueue); `feedOrder` is that order's settings (the mode, the pinned cards) and `onOrder(ids, released)`
 * saves one made by the Sort deck. `waiting` holds the projects kept out of the Feed until their "done every N days"
 * has passed ({ project, backOn }, soonest first) and `today` is the local midnight that opens today.
 */
export default function FeedView({
  queue, waiting = [], today, todosByProject, todosById, todoOps, statusesById, runningId, elapsed, feedOrder, onOrder, onOpen, onStart, onStartTask, onStop, onSkip, onCadence,
}) {
  const [sorting, setSorting] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [choosing, setChoosing] = useState(false); // the Sort button's first step: swipe or playoff
  const pad = useTasksPad();

  // The list is the projects; the Tasks card the queue carries is the pad above it
  const tasksEntry = queue.find(({ project }) => project.kind === "tasks");
  const tasksCard = tasksEntry?.project;
  const taskLines = tasksCard ? todosByProject.get(tasksCard.id) ?? [] : [];
  const projectQueue = queue.filter(({ project }) => project.kind !== "tasks");
  // Shown with no open tasks too, so one can be added from here
  const tasksPad = (
    <TasksPad
      open={pad.open}
      onOpenChange={pad.setOpen}
      color={tasksCard?.color ?? TASK_INK}
      todos={taskLines}
      todosById={todosById}
      todoOps={todoOps}
      lastWorked={tasksEntry?.lastWorked ?? null}
      isRunning={Boolean(tasksCard) && tasksCard.id === runningId}
      elapsed={elapsed}
      onOpen={() => tasksCard && onOpen(tasksCard.id)}
      onStartTask={onStartTask}
      onStop={onStop}
    />
  );

  if (projectQueue.length === 0) {
    const allWaiting = waiting.length > 0;
    return (
      <div className="mx-auto max-w-3xl">
        {tasksPad}
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

  const help = useFeedHelp();
  const nextId = projectQueue.find(({ project }) => project.id !== runningId)?.project.id;
  const mode = FEED_MODES.find((m) => m.id === feedOrder.mode) ?? FEED_MODES[0];
  // Skip sends a card to the back of My order; the others follow "Last worked" or "Last edited", which a skip does not change
  const showSkip = feedOrder.mode === "manual";
  const rotation = supportsDays(feedOrder.mode); // every order but "My order" can count the days
  // When the order follows edits, a card says when it was last edited (or last active, with work too), not last worked
  const follow = splitMode(feedOrder.mode);
  const seenOf = (entry) => {
    const at = follow.edited ? touchedAt(entry, follow) : null;
    return at ? { kind: follow.worked ? "active" : "edited", at } : undefined;
  };

  // The cards of the Sort deck: the projects in the Feed's order, then the open tasks
  const deck = [
    ...projectQueue
      .map((entry) => ({
        key: entry.project.id, kind: "project", project: entry.project, lastWorked: entry.lastWorked, seen: seenOf(entry), status: statusesById.get(entry.project.status_id), todos: todosByProject.get(entry.project.id) ?? [],
      })),
    ...taskLines
      .filter((todo) => !todo.parent_id)
      .map((todo) => ({ key: todo.id, kind: "task", todo, subs: taskLines.filter((x) => x.parent_id === todo.id).length })),
  ];

  return (
    <div className="pb-4">
      {tasksPad}
      {/* The description of each control is there when asked for (the (i) button), and under its control so it never moves them */}
      <div className="mb-4 grid items-start gap-x-6 gap-y-3 sm:grid-cols-[1fr_1fr_auto]">
        <div className="min-w-0">
          <OrderPicker mode={feedOrder.mode} onChange={feedOrder.setMode} onSort={deck.length > 1 ? () => setChoosing(true) : null} />
          {help.open && (
            <p id="feed-help-order" className="mt-1.5 font-serif text-xs italic text-muted">
              {__(mode.note)} {__("Pinned cards stay on top.")}
            </p>
          )}
        </div>
        {/* Each project's "done every N days": it can stay out of the Feed until due (any order) or, in any order but My order, be moved back by that long */}
        <div className="min-w-0">
          <CadencePicker hide={feedOrder.hide} days={feedOrder.displace && rotation} rotation={rotation} onChange={feedOrder.setRotation} />
          {help.open && (
            <p id="feed-help-cadence" className="mt-1.5 font-serif text-xs italic text-muted">
              {__(feedOrder.hide ? CADENCE_NOTES.hide : feedOrder.displace && rotation ? CADENCE_NOTES.days : CADENCE_NOTES.direct)}
            </p>
          )}
        </div>
        <button
          onClick={help.toggle}
          aria-pressed={help.open}
          aria-controls="feed-help-order feed-help-cadence"
          aria-label={__("What do these do?")}
          title={help.open ? __("Hide the descriptions") : __("What do these do?")}
          className={`grid size-8 place-items-center border border-line-strong transition-colors ${
            help.open ? "bg-text text-bg" : "text-muted hover:bg-surface-2 hover:text-text"
          }`}
        >
          <Info size={14} aria-hidden="true" />
        </button>
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
      {choosing && (
        <SortChooser
          onPick={(way) => {
            setChoosing(false);
            // The playoff orders projects only, so it needs two of them
            if (way === "playoff" && projectQueue.length > 1) setPlaying(true);
            else setSorting(true);
          }}
          onClose={() => setChoosing(false)}
        />
      )}
      {playing && <FeedPlayoff cards={deck.filter((c) => c.kind === "project")} onOrder={onOrder} onClose={() => setPlaying(false)} />}
      <ol className="space-y-3">
        {projectQueue.map((entry, i) => {
          const { project, lastWorked } = entry;
          return (
          <FeedCard
            key={project.id}
            position={i + 1}
            project={project}
            lastWorked={lastWorked}
            seen={seenOf(entry)}
            status={statusesById.get(project.status_id)}
            todos={todosByProject.get(project.id) ?? []}
            todosById={todosById}
            todoOps={todoOps}
            isRunning={project.id === runningId}
            isNext={project.id === nextId}
            pinned={feedOrder.pinned.includes(project.id)}
            onPin={() => feedOrder.togglePin(project.id)}
            canSkip={showSkip && projectQueue.length > 1 && project.id !== runningId}
            elapsed={elapsed}
            onOpen={() => onOpen(project.id)}
            onStart={() => onStart(project.id)}
            // Marks the to-do as being worked on; with this project's timer running, its session moves onto that to-do
            onWorkTodo={(todo) => (project.id === runningId ? onStart(project.id, todo.id) : todoOps.update(todo.id, { working: true }))}
            onStop={() => onStop()}
            onSkip={() => onSkip(project.id)}
            onCadence={onCadence}
          />
          );
        })}
      </ol>
      <WaitingFooter waiting={waiting} today={today} onOpen={onOpen} />
    </div>
  );
}

/** The line under the Feed for the projects kept out of it until their "done every N days" has passed: how many, when
 *  the first is back, and (opened) which ones. */
function WaitingFooter({ waiting, today, onOpen }) {
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

/**
 * The Tasks, as a post-it stuck above the list instead of being one of its cards. Its curled corner folds the note up
 * into a small flag (click it, or drag it up) so that only the projects show, and unfolds it again (click, or drag
 * down). Each task is timed on its own, a new line adds one, and the flag keeps the count and a running timer in
 * view. `todos` are the open tasks.
 */
function TasksPad({ open, onOpenChange, color, todos, todosById, todoOps, lastWorked, isRunning, elapsed, onOpen, onStartTask, onStop }) {
  const [expanded, setExpanded] = useState(false);
  // A sub-task sits right under its task; a task counts once, with its sub-tasks
  const rows = nestTodos(todos);
  const count = rows.filter((row) => !row.isSub).length;
  const shown = expanded ? rows : rows.slice(0, SHOWN_TODOS);
  const more = rows.length - shown.length;

  // A drag of the corner down unfolds the note, one up folds it; a plain press toggles it
  const press = useRef(null);
  const dragged = useRef(false);
  const onPointerDown = (e) => {
    dragged.current = false;
    press.current = e.clientY;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerUp = (e) => {
    if (press.current === null) return;
    const dy = e.clientY - press.current;
    press.current = null;
    if (Math.abs(dy) < 14) return; // not a drag: the click that follows toggles
    dragged.current = true;
    onOpenChange(dy > 0);
  };
  const onClick = () => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    onOpenChange(!open);
  };

  return (
    <section aria-label={__("Tasks")} className="mb-4">
      <div className="postit" data-open={open}>
        <div className="postit-note">
          <div className="postit-head flex h-11 items-center gap-2 px-3">
            <StickyNote size={15} aria-hidden="true" className="shrink-0 text-muted" />
            <span className="font-hand text-[26px] font-semibold leading-none">{__("Tasks")}</span>
            <span className="figures text-xs text-muted">{count}</span>
            {isRunning && (
              <>
                <span className="blink-dot size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                <span className="figures text-xs">{fmtClock(elapsed)}</span>
              </>
            )}
          </div>

          <div id="feed-tasks-pad" className="pad-sheet" data-open={open} inert={!open}>
            <div className="pad-clip">
              <div className="pad-paper">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3">
                  <span className="font-serif text-xs italic text-muted">
                    {isRunning
                      ? __("Working on it now")
                      : lastWorked
                        ? __("Last worked {formatDistanceToNowStrict}", { formatDistanceToNowStrict: formatDistanceToNowStrict(lastWorked, { addSuffix: true }) })
                        : __("Never worked")}
                  </span>
                  {count > 0 && (
                    <button onClick={onOpen} className="ml-auto text-xs text-muted underline underline-offset-2 transition-colors hover:text-text">
                      {__("Open the Tasks tab")}
                    </button>
                  )}
                </div>

                {rows.length > 0 ? (
                  <ul className="mx-3 mt-1.5 border-t border-rule">
                    {shown.map(({ todo, isSub }, i) => (
                      <TodoLine
                        key={todo.id}
                        todo={todo}
                        isSub={isSub}
                        todosById={todosById}
                        ops={todoOps}
                        onTop={i > 0 && !isSub ? () => todoOps.moveToTop(todo.id) : undefined}
                        canStart
                        onStart={() => onStartTask(todo)}
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
                  <p className="px-3 py-2 font-hand text-xl text-faint">{__("No open tasks")}</p>
                )}

                <AddTodo projectId={null} name={__("Tasks")} noun="task" ops={todoOps} className="mx-3" />

                {/* The right is left clear for the corner */}
                <div className="flex min-h-5 items-center justify-end gap-2 pb-4 pl-3 pr-10 pt-2">
                  {isRunning && (
                    <button
                      onClick={onStop}
                      aria-label={__("Stop {name}", { name: __("Tasks") })}
                      className="flex h-8 min-w-[6.5rem] items-center justify-center gap-1.5 border px-3 text-xs font-semibold"
                      style={{ background: color, borderColor: color, color: ON_INK }}
                    >
                      <Square size={10} fill="currentColor" />
                      <span className="figures text-[13px]">{fmtClock(elapsed)}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* The corner is what folds and unfolds the note: click it, or drag it up to fold and down to unfold */}
        <button
          type="button"
          aria-expanded={open}
          aria-controls="feed-tasks-pad"
          aria-label={open ? __("Fold the note up to hide the tasks") : __("Unfold the note to see your tasks")}
          title={open ? __("Fold the note up to hide the tasks") : __("Unfold the note to see your tasks")}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (press.current = null)}
          onClick={onClick}
          className="postit-curl"
        >
          <span aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

/** A row of exclusive choices drawn as joined buttons: `options` is [{ id, label, icon }]. */
function Segmented({ label, value, options, onChange }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex border border-line-strong">
      {options.map(({ id, label: text, icon: Icon, title }) => (
        <button
          key={id}
          role="radio"
          aria-checked={id === value}
          title={title}
          onClick={() => onChange(id)}
          className={`${SEGMENT} ${segmentTone(id === value)}`}
        >
          <Icon size={13} aria-hidden="true" />
          {text}
        </button>
      ))}
    </div>
  );
}

const SEGMENT = "inline-flex h-8 items-center gap-1.5 border-l border-line-strong px-2.5 text-[13px] font-semibold transition-colors first:border-l-0";
const segmentTone = (on) => (on ? "bg-text text-bg" : "text-muted hover:bg-surface-2 hover:text-text");

/**
 * The Feed's order. "Worked" and "Edited" select what to follow: either one, or both at once (a project counts from
 * whichever of the two is later), with the way (newest or oldest first) beside them. "My order" is the other choice, and
 * it carries Sort, since Sort is how that order is made; it has no direction.
 */
function OrderPicker({ mode, onChange, onSort }) {
  const { worked, edited, dir, manual } = splitMode(mode);
  // "My order" has no direction: when it is left, the way last chosen is the way back
  const lastDir = useRef(dir ?? "oldest");
  if (dir) lastDir.current = dir;
  // Each button cycles three states. Pressing it while it is the only one on hands over to the other one; pressing it
  // while only the other is on adds it (both); pressing it with both on keeps only the one pressed. So Edited goes
  // edited only → worked only → both → edited only, and Worked goes worked only → edited only → both → worked only
  const toggle = (key) => {
    const other = key === "worked" ? "edited" : "worked";
    const on = key === "worked" ? worked : edited;
    const otherOn = key === "worked" ? edited : worked;
    let next;
    if (manual || (on && otherOn)) next = { worked: false, edited: false, [key]: true };
    else if (on) next = { worked: false, edited: false, [other]: true };
    else next = { worked: true, edited: true };
    onChange(joinMode(next, lastDir.current));
  };
  const switches = [
    { key: "worked", label: __("Worked"), icon: Clock, on: worked, title: __("Count the last time you worked on a project: a timer or a to-do ticked off") },
    { key: "edited", label: __("Edited"), icon: Pencil, on: edited, title: __("Count the last time a project was changed: its details, status, notes or to-dos") },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
      <div role="group" aria-label={__("Follow")} className="inline-flex border border-line-strong">
        {switches.map(({ key, label, icon: Icon, on, title }) => (
          <button key={key} aria-pressed={on} title={title} onClick={() => toggle(key)} className={`${SEGMENT} ${segmentTone(on)}`}>
            <Icon size={13} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <div className="inline-flex border border-line-strong">
        <button role="radio" aria-checked={manual} onClick={() => onChange("manual")} className={`${SEGMENT} ${segmentTone(manual)}`}>
          <Hand size={13} aria-hidden="true" />
          {__("My order")}
        </button>
        {manual && onSort && (
          <button onClick={onSort} title={__("Put your projects in order: swipe through them, or play them off two at a time")} className={`${SEGMENT} text-text hover:bg-surface-2`}>
            <Layers size={13} aria-hidden="true" />
            {__("Sort")}
          </button>
        )}
      </div>
      {dir && (
        <Segmented
          label={__("Direction")}
          value={dir}
          options={[
            { id: "newest", label: __("Newest first"), icon: ArrowDown },
            { id: "oldest", label: __("Oldest first"), icon: ArrowUp },
          ]}
          onChange={(id) => onChange(joinMode({ worked, edited }, id))}
        />
      )}
    </div>
  );
}

/** How each project's "done every N days" counts: kept out of the Feed until due, plus its days (rotation only), or not at all. */
function CadencePicker({ hide, days, rotation, onChange }) {
  const options = [
    { id: "hide", label: __("Hide until due"), icon: EyeOff, title: __(CADENCE_NOTES.hide) },
    ...(rotation ? [{ id: "days", label: __("Plus days"), icon: CalendarPlus, title: __(CADENCE_NOTES.days) }] : []),
    { id: "direct", label: __("Direct"), icon: ArrowRight, title: __(CADENCE_NOTES.direct) },
  ];
  return <Segmented label={__("Cadence")} value={hide ? "hide" : days ? "days" : "direct"} options={options} onChange={onChange} />;
}

function FeedCard({
  position, project, lastWorked, seen, status, todos, todosById, todoOps, isRunning, isNext, pinned, onPin, canSkip, elapsed, onOpen, onStart, onWorkTodo, onStop, onSkip, onCadence,
}) {
  const { color, name } = project;
  const planCtx = usePlanContext();
  const planned = planCtx?.has("project", project.id);
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
              aria-label={__("Open {name}: to-dos and sessions", { name })}
              className="min-w-0 text-left font-serif text-[16px] font-medium leading-snug underline-offset-4 hover:underline focus-visible:underline"
            >
              <span className="line-clamp-2 break-words">{name}</span>
            </button>
            {isNext && (
              <span className="mt-0.5 shrink-0 border border-line-strong px-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{__("Up next")}</span>
            )}
            {planCtx && (
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
              className={`${planCtx ? "" : "ml-auto "}grid size-6 shrink-0 place-items-center transition-colors hover:bg-surface-2 hover:text-text ${
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
                : seen
                  ? seen.kind === "active"
                    ? __("Last active {formatDistanceToNowStrict}", { formatDistanceToNowStrict: formatDistanceToNowStrict(seen.at, { addSuffix: true }) })
                    : __("Last edited {formatDistanceToNowStrict}", { formatDistanceToNowStrict: formatDistanceToNowStrict(seen.at, { addSuffix: true }) })
                  : lastWorked
                    ? __("Last worked {formatDistanceToNowStrict}", { formatDistanceToNowStrict: formatDistanceToNowStrict(lastWorked, { addSuffix: true }) })
                    : __("Never worked")}
            </span>
            {/* "Done every N days" is set from here, not only from the project's edit window */}
            {onCadence && <CadenceChip days={project.cadence_days || 0} onChange={(days) => onCadence(project.id, days)} />}
          </p>
        </div>
      </div>

      {todos.length > 0 ? (
        <ul className="mx-3 mt-2.5 border-t border-rule sm:ml-[2.125rem]">
          {shown.map(({ todo, isSub }) => (
            <TodoLine
              key={todo.id}
              todo={todo}
              isSub={isSub}
              todosById={todosById}
              ops={todoOps}
              // In a project the timer is the card's own Start, and a to-do is only marked as being worked on
              onWork={() => onWorkTodo(todo)}
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

      <AddTodo projectId={project.id} name={name} ops={todoOps} />

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
          title={__("Put first: top of the Tasks list")}
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
function AddTodo({ projectId, name, noun = "to-do", ops, className = "mx-3 sm:ml-[2.125rem]" }) {
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
    <form onSubmit={add} className={`flex items-center gap-2 border-b border-rule focus-within:border-text ${className}`}>
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
