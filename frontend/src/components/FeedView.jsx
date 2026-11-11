import { useEffect, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { ArrowDownToLine, ArrowUpToLine, Layers, Pin, PinOff, Play, Plus, SkipForward, Square } from "lucide-react";
import { ON_INK, iconFor, inkFor, inkText, tint } from "../lib/palette";
import { fmtClock } from "../lib/time";
import { Button } from "./Modal";
import ParentTag from "./ParentTag";
import FeedSwipe from "./FeedSwipe";
import { FEED_MODES } from "../lib/feedOrder";

const SHOWN_TODOS = 5; // more than this and the rest are behind "+N more", which opens the project

/**
 * What to work on next: the open projects as a queue, the one idle longest first, each with
 * its open to-dos, which can be added, edited and ticked right here (adding or ticking one
 * counts as working on the project, so it goes to the back too). Starting a timer (from the
 * project or from one of its to-dos) puts the project at the back once time is logged; Skip
 * puts it there straight away. `queue` is [{ project, lastWorked }] in order (see feedQueue),
 * `todosByProject` maps a project id to its open to-dos, `todosById` holds every to-do (to name
 * a sub-to-do's parent) and `todoOps` is the tracker's add / update. `queue` arrives already in the order to
 * show (see orderQueue); `feedOrder` is that order's settings (the mode, the pinned cards) and `onOrder(ids, released)`
 * saves one made by the Sort deck.
 */
export default function FeedView({
  queue, todosByProject, todosById, todoOps, statusesById, runningId, elapsed, feedOrder, onOrder, onOpen, onStart, onStartTask, onStop, onSkip,
}) {
  const [sorting, setSorting] = useState(false);
  if (queue.length === 0) {
    return (
      <div className="mx-auto grid min-h-[16rem] max-w-3xl place-items-center border border-dashed border-line-strong p-6 text-center">
        <div>
          <p className="font-serif text-lg font-semibold">Nothing to work on</p>
          <p className="mt-1 text-[13px] text-muted">Finished and archived projects don't show up here.</p>
        </div>
      </div>
    );
  }

  const nextId = queue.find(({ project }) => project.id !== runningId)?.project.id;
  const mode = FEED_MODES.find((m) => m.id === feedOrder.mode) ?? FEED_MODES[0];
  // Skip sends a card to the back of the rotation; the "recently edited" order has no back to send it to
  const showSkip = feedOrder.mode !== "edited";

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
        <p className="min-w-0 flex-1 basis-56 font-serif text-[13px] italic text-muted">{mode.note} Pinned cards stay on top.</p>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          Order
          <select
            value={feedOrder.mode}
            onChange={(e) => feedOrder.setMode(e.target.value)}
            className="h-8 border border-line-strong bg-surface px-2 text-[13px] font-semibold text-text outline-none focus:border-text"
          >
            {FEED_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        {deck.length > 1 && (
          <button
            onClick={() => setSorting(true)}
            className="inline-flex h-8 items-center gap-1.5 border border-line-strong px-2.5 text-xs font-semibold transition-colors hover:border-text hover:bg-surface-2"
            title="Swipe through your projects and tasks to put them in order"
          >
            <Layers size={13} aria-hidden="true" /> Sort
          </button>
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
            onStop={() => onStop()}
            onSkip={() => onSkip(project.id)}
          />
        ))}
      </ol>
    </div>
  );
}

function FeedCard({
  position, project, lastWorked, status, todos, todosById, todoOps, isRunning, isNext, pinned, onPin, canSkip, elapsed, onOpen, onStart, onStartTask, onStop, onSkip,
}) {
  const { color, name } = project;
  // The tasks, as one card: each is timed on its own (not the card), and a new line adds a task
  const isTasks = project.kind === "tasks";
  const Icon = iconFor(project.icon);
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? todos : todos.slice(0, SHOWN_TODOS);
  const more = todos.length - shown.length;
  const edge = isRunning ? tint(color, 55) : "var(--line)";

  return (
    // The sides are set one by one: a changing `borderColor` next to `borderLeftColor` makes React warn
    <li
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
              aria-label={isTasks ? "Open the Tasks tab" : `Open ${name}: notes and to-dos`}
              className="min-w-0 text-left font-serif text-[16px] font-medium leading-snug underline-offset-4 hover:underline focus-visible:underline"
            >
              <span className="line-clamp-2 break-words">{name}</span>
            </button>
            {isNext && (
              <span className="mt-0.5 shrink-0 border border-line-strong px-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Up next
              </span>
            )}
            <button
              onClick={onPin}
              aria-pressed={pinned}
              aria-label={pinned ? `Unpin ${name}` : `Pin ${name} to the top of the Feed`}
              title={pinned ? "Pinned to the top. Click to unpin" : "Pin to the top of the Feed"}
              className={`ml-auto grid size-6 shrink-0 place-items-center transition-colors hover:bg-surface-2 hover:text-text ${
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
                ? "Working on it now"
                : lastWorked
                  ? `Last worked ${formatDistanceToNowStrict(lastWorked, { addSuffix: true })}`
                  : "Never worked"}
            </span>
          </p>
        </div>
      </div>

      {todos.length > 0 ? (
        <ul className="mx-3 mt-2.5 border-t border-rule sm:ml-[2.125rem]">
          {shown.map((todo, i) => (
            <TodoLine
              key={todo.id}
              todo={todo}
              todosById={todosById}
              ops={todoOps}
              canSkip={i === 0 && todos.length > 1}
              // In the Tasks card a line can be brought to the top; that puts the card on top of the Feed too
              onTop={
                isTasks && i > 0
                  ? () => {
                      todoOps.moveToTop(todo.id);
                      if (!pinned) onPin();
                    }
                  : undefined
              }
              canStart={isTasks || !isRunning}
              onStart={isTasks ? () => onStartTask(todo) : onStart}
            />
          ))}
          {(more > 0 || expanded) && todos.length > SHOWN_TODOS && (
            <li className="py-1.5 pl-1">
              <button
                onClick={() => setExpanded((e) => !e)}
                aria-expanded={expanded}
                className="text-[13px] text-muted underline underline-offset-2 transition-colors hover:text-text"
              >
                {expanded ? "Show fewer" : `+${more} more to-do${more === 1 ? "" : "s"}`}
              </button>
            </li>
          )}
        </ul>
      ) : (
        <p className="px-3 py-2 font-serif text-xs italic text-faint sm:pl-[2.125rem]">No open to-dos</p>
      )}

      <AddTodo projectId={isTasks ? null : project.id} name={name} noun={isTasks ? "task" : "to-do"} ops={todoOps} />

      <div className="flex items-center justify-end gap-2 px-3 pb-3 pt-2.5">
        {canSkip && (
          <Button
            variant="outline"
            className="h-8 text-xs"
            onClick={onSkip}
            aria-label={`Skip ${name} to the back of the queue`}
            title="Move to the back of the queue"
          >
            <SkipForward size={13} /> Skip
          </Button>
        )}
        {(!isTasks || isRunning) && (
        <button
          onClick={isRunning ? onStop : onStart}
          aria-label={isRunning ? `Stop ${name}` : `Start ${name}`}
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
              <Play size={11} fill="currentColor" /> Start
            </>
          )}
        </button>
        )}
      </div>
    </li>
  );
}

/** One open to-do: tick it, rename it (saved on blur or Enter; an emptied line goes back to what it was)
 *  or start the project's timer from it. */
function TodoLine({ todo, todosById, ops, canStart, canSkip, onTop, onStart }) {
  const [draft, setDraft] = useState(todo.text);
  useEffect(() => setDraft(todo.text), [todo.text]);

  const commit = () => {
    const text = draft.trim();
    if (!text || text === todo.text) return setDraft(todo.text);
    ops.update(todo.id, { text });
  };

  return (
    <li className="flex items-center gap-2.5 border-b border-rule pl-1">
      <input
        type="checkbox"
        checked={false}
        onChange={() => ops.update(todo.id, { done: true })}
        aria-label={`Mark "${todo.text}" done`}
        className="size-4 shrink-0 cursor-pointer accent-(--text)"
      />
      <ParentTag todo={todo} todosById={todosById} className="max-sm:max-w-[6rem]" />
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
        maxLength={200}
        aria-label="To-do"
        className="h-9 min-w-0 flex-1 bg-transparent text-[14px] outline-none focus:bg-surface-2"
      />
      {onTop && (
        <button
          onClick={onTop}
          aria-label={`Put "${todo.text}" first`}
          title="Put first: top of the list, and the Tasks card on top of the Feed"
          className="grid size-8 shrink-0 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <ArrowUpToLine size={13} />
        </button>
      )}
      {canSkip && (
        <button
          onClick={() => ops.moveToBottom(todo.id)}
          aria-label={`Skip "${todo.text}" to the bottom of the list`}
          title="Skip to the bottom of the list"
          className="grid size-8 shrink-0 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <ArrowDownToLine size={13} />
        </button>
      )}
      {canStart && (
        <button
          onClick={onStart}
          aria-label={`Work on "${todo.text}"`}
          title="Work on this"
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
  const [draft, setDraft] = useState("");

  const add = async (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    if (!(await ops.add(projectId, text))) setDraft(text);
  };

  return (
    <form onSubmit={add} className="mx-3 flex items-center gap-2 border-b border-rule focus-within:border-text sm:ml-[2.125rem]">
      <Plus size={14} className="shrink-0 text-muted" aria-hidden="true" />
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={200}
        placeholder={`Add a ${noun} and press Enter`}
        aria-label={projectId === null ? "New task" : `New to-do for ${name}`}
        className="h-9 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
      />
    </form>
  );
}
