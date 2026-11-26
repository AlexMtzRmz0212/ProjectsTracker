import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Undo2, X } from "lucide-react";
import { formatDistanceToNowStrict } from "../lib/dates";
import { iconFor, inkFor, inkText } from "../lib/palette";
import { loadAnswers, maxMatches, playoff, playoffIds, saveAnswers } from "../lib/feedPlayoff";
import { __ } from "../i18n";

/**
 * A full-screen playoff for putting the Feed in order: two projects at a time, pick the one to do first. The first
 * project starts a ladder; each next one faces the project in the middle of the places it could still take, so every
 * answer halves them (see playoff). When it is decided, "Use this order" saves it as "My order".
 * `cards` is [{ key, project, lastWorked, seen, status, todos }], `onOrder(ids, released)` saves an order. The answers
 * are kept, so closing half way and coming back carries on.
 */
export default function FeedPlayoff({ cards, onOrder, onClose }) {
  const ids = useMemo(() => playoffIds(cards.map((c) => c.key)), [cards]);
  const byId = useMemo(() => new Map(cards.map((c) => [c.key, c])), [cards]);
  const [answers, setAnswers] = useState(() => loadAnswers(ids));
  const state = useMemo(() => playoff(ids, answers), [ids, answers]);
  const max = maxMatches(ids.length);

  const change = useCallback(
    (next) => {
      setAnswers(next);
      saveAnswers(ids, next);
    },
    [ids]
  );
  const pick = useCallback((winner) => change([...answers, winner]), [answers, change]);
  const undo = useCallback(() => answers.length && change(answers.slice(0, -1)), [answers, change]);
  const restart = () => change([]);
  const finish = () => {
    // Every project is placed here, so none keeps a pin that would put it above its place
    onOrder(state.order, state.order);
    saveAnswers(ids, []);
    onClose();
  };

  // Left card = the newcomer, right card = the one in the ladder
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (!state.done && e.key === "ArrowLeft") pick(state.challenger);
      else if (!state.done && e.key === "ArrowRight") pick(state.opponent);
      else if (e.key === "Backspace" || (e.key === "z" && !e.ctrlKey && !e.metaKey)) undo();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state, pick, undo, onClose]);

  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={__("Playoff sort")} className="fixed inset-0 z-[70] flex flex-col overflow-y-auto bg-bg">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
        <h2 className="font-serif text-[17px] font-semibold">{__("Playoff sort")}</h2>
        <span className="figures font-serif text-xs italic text-muted">
          {state.done
            ? __("{n} matches played", { n: state.played })
            : __("Match {value}, at most {max}", { value: state.played + 1, max })}
        </span>
        <button
          onClick={undo}
          disabled={answers.length === 0}
          className="ml-auto inline-flex h-8 items-center gap-1.5 px-2 text-xs font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:pointer-events-none disabled:opacity-35"
          title={__("Take back the last answer (Backspace)")}
        >
          <Undo2 size={14} aria-hidden="true" />{" "}{__("Undo")}</button>
        <button
          onClick={onClose}
          aria-label={__("Close")}
          title={__("Close (Esc)")}
          className="grid size-8 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <X size={17} />
        </button>
      </div>

      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        {state.done ? (
          <div>
            <p className="text-center font-serif text-lg font-semibold">{__("The order is decided")}</p>
            <ol className="mt-4 space-y-1.5">
              {state.order.map((id, i) => (
                <LadderRow key={id} card={byId.get(id)} index={i} tone="done" />
              ))}
            </ol>
            <div className="mt-5 flex justify-center gap-3">
              <button
                onClick={restart}
                className="inline-flex h-9 items-center gap-1.5 border border-line-strong px-4 text-[13px] font-semibold transition-colors hover:bg-surface-2"
              >{__("Start over")}</button>
              <button
                onClick={finish}
                className="inline-flex h-9 items-center gap-1.5 border border-text bg-text px-4 text-[13px] font-semibold text-bg"
              >
                <Check size={14} aria-hidden="true" />{" "}{__("Use this order")}</button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-center font-serif text-lg font-semibold">{__("Which do you want to do first?")}</p>
            <div className="mt-4 grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
              <MatchCard card={byId.get(state.challenger)} fresh onPick={() => pick(state.challenger)} />
              <span className="self-center text-center font-serif text-xs italic text-faint">{__("or")}</span>
              <MatchCard card={byId.get(state.opponent)} onPick={() => pick(state.opponent)} />
            </div>
            <p className="mt-2 text-center font-serif text-xs italic text-muted">{__("← the new one · the one on the ladder →")}</p>

            <p className="mb-1.5 mt-6 text-xs text-muted">{__("The ladder, first in the Feed on top")}</p>
            <ol className="space-y-1.5">
              {state.ladder.map((id, i) => (
                <Fragment key={id}>
                  {i === state.lo && <Slot card={byId.get(state.challenger)} />}
                  <LadderRow
                    card={byId.get(id)}
                    index={i}
                    tone={i < state.lo ? "above" : i >= state.hi ? "below" : "open"}
                    mid={i === state.mid}
                    challenger={byId.get(state.challenger)}
                  />
                </Fragment>
              ))}
              {state.lo === state.ladder.length && <Slot card={byId.get(state.challenger)} />}
            </ol>
            {state.waiting.length > 0 && (
              <p className="mt-3 font-serif text-xs italic text-muted">
                {__("Still to enter: {names}", { names: state.waiting.map((id) => byId.get(id).project.name).join(", ") })}
              </p>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

function MatchCard({ card, fresh = false, onPick }) {
  const { project, lastWorked, seen, status, todos } = card;
  const Icon = iconFor(project.icon);
  return (
    <button
      onClick={onPick}
      className={`paper-card flex min-h-[13rem] flex-col border p-4 text-left transition-colors hover:border-text ${
        fresh ? "border-line-strong bg-surface" : "border-line bg-surface"
      }`}
    >
      <span className="inline-flex items-center gap-1.5 text-xs text-muted">
        <span className="size-2" style={{ background: status ? inkFor(status.color) : "var(--line-strong)" }} aria-hidden="true" />
        {status?.name ?? __("Project")}
        {fresh && <span className="ml-auto font-semibold text-accent">{__("New")}</span>}
      </span>
      <span className="mt-3 flex items-start gap-2.5">
        <Icon size={20} strokeWidth={2.25} className="mt-1 shrink-0" style={{ color: inkText(project.color) }} aria-hidden="true" />
        <span className="min-w-0 break-words font-serif text-[20px] font-medium leading-snug">{project.name}</span>
      </span>
      {todos.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-rule pt-2 text-[13px]">
          {todos.slice(0, 3).map((t) => (
            <li key={t.id} className="truncate text-muted">
              · {t.text}
            </li>
          ))}
          {todos.length > 3 && <li className="text-faint">{__("+{n} more", { n: todos.length - 3 })}</li>}
        </ul>
      )}
      <span className="mt-auto pt-3 font-serif text-xs italic text-muted">
        {seen
          ? seen.kind === "active"
            ? __("Last active {formatDistanceToNowStrict}", { formatDistanceToNowStrict: formatDistanceToNowStrict(seen.at, { addSuffix: true }) })
            : __("Last edited {formatDistanceToNowStrict}", { formatDistanceToNowStrict: formatDistanceToNowStrict(seen.at, { addSuffix: true }) })
          : lastWorked
            ? __("Last worked {formatDistanceToNowStrict}", { formatDistanceToNowStrict: formatDistanceToNowStrict(lastWorked, { addSuffix: true }) })
            : __("Never worked")}
      </span>
    </button>
  );
}

/** Where the new project could still land: between the projects it has not been compared with. */
function Slot({ card }) {
  return (
    <li className="mb-1.5 list-none border border-dashed border-line-strong px-3 py-1 font-serif text-xs italic text-accent">
      {__("{name} could land here", { name: card.project.name })}
    </li>
  );
}

const TONES = {
  above: "border-line bg-surface-2",
  below: "border-line bg-surface-2 opacity-55",
  open: "border-line-strong bg-surface",
  done: "border-line-strong bg-surface",
};

function LadderRow({ card, index, tone, mid = false, challenger }) {
  const { project } = card;
  const note =
    tone === "above" ? __("beats {name}", { name: challenger.project.name }) : tone === "below" ? __("loses to {name}", { name: challenger.project.name }) : "";
  return (
    <li className={`flex list-none items-center gap-2.5 border px-3 py-2 text-[13px] ${TONES[tone]} ${mid ? "outline outline-1 outline-text" : ""}`}>
      <span className="figures w-4 text-xs text-muted">{index + 1}</span>
      <span className="min-w-0 truncate font-medium">{project.name}</span>
      {note && <span className="ml-auto shrink-0 font-serif text-xs italic text-muted">{note}</span>}
    </li>
  );
}
