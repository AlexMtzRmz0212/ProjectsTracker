import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatDistanceToNowStrict } from "date-fns";
import { ArrowLeft, ArrowRight, Check, ListChecks, Undo2, X } from "lucide-react";
import { iconFor, inkFor, inkText } from "../lib/palette";
import { fmtHM } from "../lib/time";

const FLING_PX = 110; // dragged this far sideways, a card is decided
const FLING_SPEED = 0.55; // px per ms: a quick flick decides it sooner
const EXIT_MS = 230;

/**
 * A full-screen deck for putting the Feed in order: one card at a time, swipe it right for "do soon" or left for
 * "later" (or press → / ←, or the buttons). Projects and tasks are in the same deck.
 *  · a project swiped right goes to the front of the Feed, in the order they were swiped, and left sends it to the
 *    back (also in the order swiped); the ones not swiped stay between. That order is saved as "My order".
 *  · a task swiped right goes to the top of the Tasks list, left to the bottom.
 * `cards` is [{ key, kind: "project", project, lastWorked } | { key, kind: "task", todo }], `order` the Feed's
 * current card ids, `onOrder(ids, released)` saves an order, and `todoOps` moves the tasks. Undo takes the last swipe back.
 */
export default function FeedSwipe({ cards, order, onOrder, todoOps, onClose }) {
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState(null); // { x, y, active }
  const [leaving, setLeaving] = useState(null); // "left" | "right"
  const soon = useRef([]); // project ids swiped right, first swipe first
  const later = useRef([]);
  const taskUndo = useRef(new Map()); // task id -> the sort_order it had
  const history = useRef([]); // [{ card, dir }]
  const start = useRef(null);
  const card = cards[index];
  const done = index >= cards.length;

  // The Feed's order as it was when the deck opened: what is not swiped stays in it, so undoing a swipe puts a card back
  const base = useRef(order);
  const save = useCallback(() => {
    const touched = new Set([...soon.current, ...later.current]);
    const rest = base.current.filter((id) => !touched.has(id));
    onOrder([...soon.current, ...rest, ...later.current], [...touched]);
  }, [onOrder]);

  const decide = useCallback(
    (dir) => {
      if (!card || leaving) return;
      setLeaving(dir);
      setTimeout(() => {
        if (card.kind === "project") {
          (dir === "right" ? soon : later).current.push(card.project.id);
          save();
        } else {
          taskUndo.current.set(card.todo.id, card.todo.sort_order);
          if (dir === "right") todoOps.moveToTop(card.todo.id);
          else todoOps.moveToBottom(card.todo.id);
        }
        history.current.push({ card, dir });
        setLeaving(null);
        setDrag(null);
        setIndex((i) => i + 1);
      }, EXIT_MS);
    },
    [card, leaving, save, todoOps]
  );

  const undo = useCallback(() => {
    const last = history.current.pop();
    if (!last || leaving) return;
    if (last.card.kind === "project") {
      const list = last.dir === "right" ? soon.current : later.current;
      list.splice(list.lastIndexOf(last.card.project.id), 1);
      save();
    } else if (taskUndo.current.has(last.card.todo.id)) {
      todoOps.moveToTop(last.card.todo.id, taskUndo.current.get(last.card.todo.id));
    }
    setIndex((i) => Math.max(0, i - 1));
  }, [leaving, save, todoOps]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") decide("right");
      else if (e.key === "ArrowLeft") decide("left");
      else if (e.key === "Backspace" || (e.key === "z" && !e.ctrlKey && !e.metaKey)) undo();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [decide, undo, onClose]);

  // The page behind doesn't scroll while the deck is up
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  const onDown = (e) => {
    if (leaving || e.button > 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // keeps the drag going when the pointer leaves the card
    } catch {
      // a pointer the browser no longer knows: the drag still follows the events that arrive
    }
    start.current = { x: e.clientX, y: e.clientY, t: performance.now() };
    setDrag({ x: 0, y: 0, active: true });
  };
  const onMove = (e) => {
    if (!start.current) return;
    setDrag({ x: e.clientX - start.current.x, y: (e.clientY - start.current.y) * 0.3, active: true });
  };
  const onUp = (e) => {
    const from = start.current;
    start.current = null;
    if (!from) return;
    const dx = e.clientX - from.x;
    const speed = Math.abs(dx) / Math.max(1, performance.now() - from.t);
    if (Math.abs(dx) > FLING_PX || (Math.abs(dx) > 40 && speed > FLING_SPEED)) decide(dx > 0 ? "right" : "left");
    else setDrag(null); // not far enough: it springs back
  };

  const x = leaving ? (leaving === "right" ? 1 : -1) * 700 : drag?.x ?? 0;
  const lean = Math.max(-1, Math.min(1, (leaving ? (leaving === "right" ? 1 : -1) * 3 : (drag?.x ?? 0) / 220)));
  const hint = leaving ?? (drag && Math.abs(drag.x) > 30 ? (drag.x > 0 ? "right" : "left") : null);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Sort the Feed" className="fixed inset-0 z-[70] flex flex-col bg-bg">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
        <h2 className="font-serif text-[17px] font-semibold">Sort the Feed</h2>
        <span className="figures font-serif text-xs italic text-muted">
          {done ? "All sorted" : `${index + 1} of ${cards.length}`}
        </span>
        <button
          onClick={undo}
          disabled={index === 0 || Boolean(leaving)}
          className="ml-auto inline-flex h-8 items-center gap-1.5 px-2 text-xs font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:pointer-events-none disabled:opacity-35"
          title="Take back the last swipe (Backspace)"
        >
          <Undo2 size={14} aria-hidden="true" /> Undo
        </button>
        <button
          onClick={onClose}
          aria-label="Close"
          title="Close (Esc)"
          className="grid size-8 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <X size={17} />
        </button>
      </div>

      <div className="relative mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col items-center justify-center px-4">
        {done ? (
          <div className="text-center">
            <p className="font-serif text-lg font-semibold">All sorted</p>
            <p className="mt-1 text-[13px] text-muted">The Feed now follows your order. Pin or skip cards any time to adjust it.</p>
            <button
              onClick={onClose}
              className="mt-4 inline-flex h-9 items-center gap-1.5 border border-text bg-text px-4 text-[13px] font-semibold text-bg"
            >
              <Check size={14} aria-hidden="true" /> Back to the Feed
            </button>
          </div>
        ) : (
          <>
            {/* The card under the top one peeks out, so it reads as a stack */}
            {cards[index + 1] && (
              <div className="absolute inset-x-8 top-1/2 h-[22rem] -translate-y-1/2 scale-95 border border-line bg-surface-2" aria-hidden="true" />
            )}
            <div
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={() => {
                start.current = null;
                setDrag(null);
              }}
              className="paper-card relative h-[22rem] w-full cursor-grab touch-none select-none border border-line-strong bg-surface active:cursor-grabbing"
              style={{
                transform: `translate(${x}px, ${drag?.y ?? 0}px) rotate(${lean * 9}deg)`,
                transition: drag?.active && !leaving ? "none" : `transform ${EXIT_MS}ms ease-out`,
              }}
            >
              <Card card={card} />
              <span
                className={`absolute left-4 top-4 -rotate-12 border-2 px-2 py-0.5 font-hand text-2xl font-semibold uppercase transition-opacity ${
                  hint === "right" ? "opacity-100" : "opacity-0"
                }`}
                style={{ color: "var(--accent-2)", borderColor: "var(--accent-2)" }}
                aria-hidden="true"
              >
                Do soon
              </span>
              <span
                className={`absolute right-4 top-4 rotate-12 border-2 border-muted px-2 py-0.5 font-hand text-2xl font-semibold uppercase text-muted transition-opacity ${
                  hint === "left" ? "opacity-100" : "opacity-0"
                }`}
                aria-hidden="true"
              >
                Later
              </span>
            </div>
          </>
        )}
      </div>

      {!done && (
        <div className="flex shrink-0 flex-col items-center gap-2 pb-6 pt-2">
          <div className="flex items-center gap-6">
            <button
              onClick={() => decide("left")}
              className="inline-flex h-12 min-w-[7.5rem] items-center justify-center gap-2 border border-line-strong text-[13px] font-semibold transition-colors hover:border-text hover:bg-surface-2"
              aria-label="Later: send it to the back (left arrow)"
            >
              <ArrowLeft size={16} aria-hidden="true" /> Later
            </button>
            <button
              onClick={() => decide("right")}
              className="inline-flex h-12 min-w-[7.5rem] items-center justify-center gap-2 border border-text bg-text text-[13px] font-semibold text-bg"
              aria-label="Do soon: bring it to the front (right arrow)"
            >
              Do soon <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
          <p className="px-4 text-center font-serif text-xs italic text-muted">
            Projects go to the front or back of the Feed. Tasks go to the top or bottom of the Tasks list.
          </p>
        </div>
      )}
    </div>,
    document.body
  );
}

function Card({ card }) {
  if (card.kind === "task") {
    const { todo } = card;
    return (
      <div className="flex h-full flex-col p-5">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <ListChecks size={14} aria-hidden="true" /> Task
        </span>
        <p className="mt-3 break-words font-serif text-[22px] font-medium leading-snug">{todo.text}</p>
        <p className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {todo.working_since && <span className="font-semibold text-accent">Working on it</span>}
          {todo.total_seconds >= 60 && <span className="figures">{fmtHM(todo.total_seconds)} logged</span>}
          {card.subs > 0 && <span>{card.subs} sub-tasks</span>}
        </p>
      </div>
    );
  }
  const { project, lastWorked, status, todos } = card;
  const Icon = iconFor(project.icon);
  return (
    <div className="flex h-full flex-col p-5">
      <span className="inline-flex items-center gap-1.5 text-xs text-muted">
        <span className="size-2" style={{ background: status ? inkFor(status.color) : "var(--line-strong)" }} aria-hidden="true" />
        {status?.name ?? "Project"}
      </span>
      <div className="mt-3 flex items-start gap-2.5">
        <Icon size={20} strokeWidth={2.25} className="mt-1 shrink-0" style={{ color: inkText(project.color) }} aria-hidden="true" />
        <p className="min-w-0 break-words font-serif text-[22px] font-medium leading-snug">{project.name}</p>
      </div>
      {todos.length > 0 && (
        <ul className="mt-4 space-y-1 border-t border-rule pt-3 text-[13px]">
          {todos.slice(0, 4).map((t) => (
            <li key={t.id} className="truncate text-muted">
              · {t.text}
            </li>
          ))}
          {todos.length > 4 && <li className="text-faint">+{todos.length - 4} more</li>}
        </ul>
      )}
      <p className="mt-auto font-serif text-xs italic text-muted">
        {lastWorked ? `Last worked ${formatDistanceToNowStrict(lastWorked, { addSuffix: true })}` : "Never worked"}
      </p>
    </div>
  );
}
