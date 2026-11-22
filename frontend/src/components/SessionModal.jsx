import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Hourglass, Moon, Plus, Search, Tag, Trash2, TriangleAlert } from "lucide-react";
import Modal, { Button } from "./Modal";
import { matchProjects } from "./ProjectSearch";
import { choreKey, choreLabelOf, isChoreKey } from "../api";
import { CHORE_ICON, CHORE_INK, iconFor, inkText, tint } from "../lib/palette";
import {
  dayKey, fmtDurationInput, fmtHM, parseClock, parseDuration, toDateInput, toTimeInput,
} from "../lib/time";
import { __, __r, useT } from "../i18n";

const QUICK_MINUTES = [15, 30, 45, 60, 90, 120, 180, 240];
const MINUTE = 60_000;
const DAY = 86_400_000;
const fieldClass =
  "h-10 w-full min-w-0 border-0 border-b border-line-strong bg-transparent px-0 outline-none transition-colors focus:border-b-2 focus:border-accent-2 focus-visible:outline-none";
const timeFieldClass = `${fieldClass} figures text-[15px]`;
const labelClass = "mb-1 block text-xs font-semibold text-muted";

const atMinute = (day, minutes) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60);
const flooredMinute = (date) => new Date(Math.floor(date.getTime() / MINUTE) * MINUTE);

/** Where a new entry starts out: the stretch picked on the calendar (`span`; with only a start, the hour
 *  from there, never past now), else the hour that just ended (today), or an hour ending at 18:00. An open
 *  item starts where it started, ending now if it gets closed here. */
function initialSpan(session, openItem, date, span) {
  if (session) return { start: session.start, end: session.end };
  if (openItem) return { start: openItem.start, end: new Date(Math.max(flooredMinute(new Date()), openItem.start.getTime() + MINUTE)) };
  if (span) {
    const end = span.end ?? new Date(Math.min(span.start.getTime() + 60 * MINUTE, flooredMinute(new Date()).getTime()));
    return { start: span.start, end };
  }
  const today = dayKey(date) === dayKey(new Date());
  const end = today ? new Date(Math.floor(Date.now() / (5 * MINUTE)) * 5 * MINUTE) : atMinute(date, 18 * 60);
  return { start: new Date(end.getTime() - 60 * MINUTE), end };
}

/**
 * Log time after the fact, edit an existing session, or start something to close later.
 *
 * Type any of the three (start, end, duration) and the others keep up: start and end give the duration, and a
 * duration moves whichever of start and end was not set last (the anchor). Time is usually logged just after the
 * fact, so it begins anchored on the end ("2h, finished now": one tap on a chip). Set the start (typed, or "now") and
 * the anchor is the start: a duration then moves the end. Set the end (typed, or "now") and the start follows again.
 * A start of now with a duration ends in the future, which can't be saved as a session: "Still going" is for that.
 *
 * "Leave it open" turns it into an open item: only the start is kept, and it runs (alongside the timer)
 * until it is closed. `openItem` edits one that is open: keep it open, or switch it off to close it at the end given.
 *
 * `projects` are the subjects time can go on: open projects and tasks. Before anything is typed only `suggested`
 * (ids: what was logged on lately, what is running or being worked on, recent chores) is offered, as chips; typing
 * searches them all. There is no note: a session keeps the one it has.
 */
export default function SessionModal({
  session, openItem, projectId, date, span, startOpen = false, projects, todos = [], chores = [], suggested = [], onClose, onSave, onDelete, onSaveOpen, onCloseOpen,
}) {
  useT();
  const first = initialSpan(session, openItem, date, span);
  const [pid, setPid] = useState(
    session?.project_id ?? openItem?.project_id ?? projectId ?? suggested.find((id) => projects.some((p) => p.id === id)) ?? projects[0]?.id
  );
  const [start, setStart] = useState(startOpen ? flooredMinute(new Date()) : first.start);
  const [end, setEnd] = useState(first.end);
  // Which of start and end the person set last: a duration moves the other one
  const [anchor, setAnchor] = useState("end");
  const [open, setOpen] = useState(Boolean(openItem) || startOpen);
  const [saving, setSaving] = useState(false);
  // The field being typed in keeps its raw text; the others are shown from start and end
  const [typing, setTyping] = useState({ field: null, text: "" });

  // The list is searchable: Ctrl+F (⌘F) jumps to the filter instead of the browser's find. Like the pomodoro's
  // picker, words that match no project or task can be used as a chore: time with only a label.
  const [query, setQuery] = useState("");
  const searchRef = useRef(null);
  const q = query.trim();
  const visible = useMemo(() => matchProjects(projects, query), [projects, query]);
  // Typed, it finds open to-dos by name too: picking one files the time under what it belongs to
  const todoHits = useMemo(() => (q ? matchProjects(todos, query).slice(0, 8) : []), [todos, query, q]);
  // ...and the chores logged before. An open item has to be on a project or task, so it gets no chores.
  const choreHits = useMemo(
    () => (q && !open ? matchProjects(chores.filter((c) => !projects.some((p) => p.id === c.id)), query).slice(0, 8) : []),
    [chores, projects, query, q, open]
  );
  const exactHit = q ? [...visible, ...choreHits].find((x) => x.name.toLowerCase() === q.toLowerCase()) : null;
  const newChore = q && !open && !exactHit && choreKey(q.slice(0, 120)) !== pid ? choreKey(q.slice(0, 120)) : null;
  const firstHit = exactHit?.id ?? visible[0]?.id ?? choreHits[0]?.id ?? todoHits[0]?.subjectId ?? newChore;
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "f") return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // A chore picked but not logged before has no subject yet: make one to show and color it
  const chosenChore = isChoreKey(pid)
    ? projects.find((p) => p.id === pid) ?? chores.find((c) => c.id === pid) ??
      { id: pid, kind: "chore", name: choreLabelOf(pid), color: CHORE_INK, icon: CHORE_ICON }
    : null;
  const project = projects.find((p) => p.id === pid) ?? chosenChore ?? undefined;
  // Nothing typed: the chosen one and the suggested ones (an open item has no chores); typed: every match
  const byId = new Map([...chores, ...projects].map((p) => [p.id, p]));
  const offered = [project, ...suggested.map((id) => byId.get(id))].filter((p, i, all) => p && !(open && p.kind === "chore") && all.findIndex((x) => x?.id === p.id) === i);
  const chips = q
    ? [
        ...(chosenChore && !projects.some((p) => p.id === pid) ? [chosenChore] : []),
        ...visible,
        ...choreHits.filter((c) => c.id !== pid),
      ]
    : offered;
  const hidden = q ? 0 : Math.max(0, projects.length - offered.filter((p) => p.kind !== "chore").length);

  const canOpen = Boolean(onSaveOpen) && !session && !chosenChore; // a session already logged stays a session; a chore can't be left open
  const color = project?.color ?? "var(--accent-2)";
  const minutes = Math.round((end - start) / MINUTE);
  const crossesMidnight = dayKey(start) !== dayKey(end);
  const inFuture = open ? start > new Date(Date.now() + MINUTE) : end > new Date(Date.now() + MINUTE);
  const valid = Boolean(project && !inFuture && (open || minutes > 0));
  const soFar = Math.max(0, (Date.now() - start) / 1000);

  const shown = {
    start: toTimeInput(start),
    end: toTimeInput(end),
    duration: minutes > 0 ? fmtDurationInput(minutes) : "",
  };

  // ── Edits. Setting the start or the end makes it the anchor; a duration moves the other one ──────────────

  const setEndTime = (m) => {
    // The end keeps its day; a time before the start can only mean the next day
    let next = atMinute(end, m);
    if (next <= start) next = new Date(next.getTime() + DAY);
    setEnd(next);
    setAnchor("end");
  };
  const setStartTime = (m) => {
    setAnchor("start");
    if (open) return setStart(atMinute(start, m)); // nothing to keep before: the start keeps its day
    // The start is the latest moment with that clock time before the end
    let next = atMinute(end, m);
    if (next >= end) next = new Date(next.getTime() - DAY);
    setStart(next);
  };
  const setDuration = (mins) => {
    if (anchor === "start") setEnd(new Date(start.getTime() + mins * MINUTE));
    else setStart(new Date(end.getTime() - mins * MINUTE));
  };
  const setDay = (day) => {
    if (open) return setStart(atMinute(day, start.getHours() * 60 + start.getMinutes()));
    const shift = atMinute(day, end.getHours() * 60 + end.getMinutes()) - end;
    setStart(new Date(start.getTime() + shift));
    setEnd(new Date(end.getTime() + shift));
  };
  /** Ended now: the end is the anchor again, and the start follows, keeping the duration chosen. */
  const endNow = () => {
    const now = flooredMinute(new Date());
    setStart(new Date(now.getTime() - Math.max(minutes, 1) * MINUTE));
    setEnd(now);
    setAnchor("end");
  };
  /** Started now: the start is the anchor, and the end follows, keeping the duration chosen (which puts it in
   *  the future, so it can't be saved until a shorter duration, End → now, or "Still going" is used). */
  const startNow = () => {
    const now = flooredMinute(new Date());
    setStart(now);
    if (!open) setEnd(new Date(now.getTime() + Math.max(minutes, 1) * MINUTE));
    setAnchor("start");
  };
  const toggleOpen = (next) => {
    setOpen(next);
    // Closing it here: it ends now, unless an end after the start was already set
    if (!next && end <= start) setEnd(new Date(Math.max(flooredMinute(new Date()), start.getTime() + MINUTE)));
  };

  const parsers = {
    start: [parseClock, setStartTime],
    end: [parseClock, setEndTime],
    duration: [parseDuration, setDuration],
  };
  const field = (name) => ({
    value: typing.field === name ? typing.text : shown[name],
    onFocus: (e) => {
      setTyping({ field: name, text: shown[name] });
      e.target.select();
    },
    onChange: (e) => {
      setTyping({ field: name, text: e.target.value });
      const [parse, apply] = parsers[name];
      const parsed = parse(e.target.value);
      if (parsed !== null) apply(parsed);
    },
    onBlur: () => setTyping({ field: null, text: "" }),
  });

  const today = new Date();
  const anchorDay = dayKey(open ? start : end);
  const isToday = anchorDay === dayKey(today);
  const isYesterday = anchorDay === dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));

  const submit = async (e) => {
    e?.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    // No note: an existing one is kept (it isn't sent), and a new session has none
    const data = { project_id: pid, start };
    const ok =
      open ? await onSaveOpen(openItem, data)
      : openItem ? await onCloseOpen(openItem, { ...data, end })
      : await onSave({ ...data, end });
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Modal
      title={openItem ? __("Open item") : session ? __("Edit session") : open ? __("Start something open") : __("Add time")}
      onClose={onClose}
      footer={
        <>
          {(session || openItem) && (
            <Button variant="danger" onClick={() => onDelete(session ?? openItem)}>
              <Trash2 size={15} /> <span className="hidden sm:inline">{openItem ? __("Discard") : __("Delete")}</span>
            </Button>
          )}
          <Button className="ml-auto" onClick={onClose}>{__("Cancel")}</Button>
          <Button variant="primary" onClick={submit} disabled={!valid || saving}>
            <Check size={16} /> {openItem && !open ? __("Close it") : open && !openItem ? __("Start") : __("Save")}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <fieldset>
          <legend className={labelClass}>{__("Project or task")}</legend>
          <div className="mb-2 flex items-center gap-2 border-b border-line-strong focus-within:border-text">
            <Search size={15} className="shrink-0 text-muted" aria-hidden="true" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault(); // Enter picks the best match (or the words as a chore) instead of saving
                if (firstHit) setPid(firstHit);
              }}
              aria-label={__("Search projects and tasks, or name a chore")}
              placeholder={open ? __("Search (Ctrl+F), Enter picks the first") : __("Search (Ctrl+F), or type a chore")}
              autoComplete="off"
              spellCheck={false}
              className="h-9 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
            />
          </div>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={__("Project or task")}>
            {chips.map((p) => {
              const Icon = iconFor(p.icon);
              const active = p.id === pid;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setPid(p.id)}
                  className={`inline-flex h-9 max-w-full items-center gap-2 border px-3 text-[13px] font-medium transition-colors ${
                    active ? "" : "border-line text-muted hover:border-line-strong hover:text-text"
                  } ${p.kind === "task" ? "border-dashed" : p.kind === "chore" ? "border-dotted" : ""}`}
                  title={p.kind === "chore" ? __("Chore: time with no project") : undefined}
                  style={active ? { borderColor: p.color, background: tint(p.color, 14) } : undefined}
                >
                  <Icon size={15} style={{ color: inkText(p.color) }} className="shrink-0" />
                  <span className="truncate">{p.name}</span>
                </button>
              );
            })}
            {projects.length === 0 && <p className="text-[13px] text-muted">{__("No open projects or tasks.")}</p>}
            {/* A chore is time with no project: always one tap away, named in the search above */}
            {!q && !open && (
              <button
                type="button"
                onClick={() => searchRef.current?.focus()}
                title={__("Type a name in the search above to use it as a chore")}
                className="inline-flex h-9 max-w-full items-center gap-2 border border-dotted border-line-strong px-3 text-[13px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text"
              >
                <Plus size={15} className="shrink-0" aria-hidden="true" />
                <span className="truncate">{__("New chore")}</span>
              </button>
            )}
            {hidden > 0 && (
              <p className="basis-full text-xs text-faint">{__("Showing what you worked on lately. Search above for any of the other {n}.", { n: hidden })}</p>
            )}
            {todoHits.map((x) => {
              const Icon = iconFor(x.icon);
              const active = x.subjectId === pid;
              return (
                <button
                  key={x.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setPid(x.subjectId)}
                  title={__("To-do in {in}", { in: x.in })}
                  className={`inline-flex h-9 max-w-full items-center gap-2 border border-dotted px-3 text-[13px] font-medium transition-colors ${
                    active ? "" : "border-line text-muted hover:border-line-strong hover:text-text"
                  }`}
                  style={active ? { borderColor: x.color, background: tint(x.color, 14) } : undefined}
                >
                  <Icon size={15} style={{ color: inkText(x.color) }} className="shrink-0" />
                  <span className="truncate">
                    {x.name} <span className="font-normal text-faint">{__("in {name}", { name: x.in })}</span>
                  </span>
                </button>
              );
            })}
            {newChore && (
              <button
                type="button"
                onClick={() => setPid(newChore)}
                className="inline-flex h-9 max-w-full items-center gap-2 border border-dotted border-line-strong px-3 text-[13px] font-medium text-text transition-colors hover:bg-surface-2"
              >
                <Tag size={15} className="shrink-0 text-muted" aria-hidden="true" />
                <span className="truncate">
                  {__r("Use “{name}” as a chore", { name: <b>{q}</b> })}
                </span>
              </button>
            )}
            {q && chips.length === 0 && todoHits.length === 0 && !newChore && (
              <p className="text-[13px] text-muted">{__("Nothing matches “{query}”.", { query: q })}</p>
            )}
          </div>
        </fieldset>

        {/* Big duration readout */}
        <div
          className="flex items-center justify-center gap-3 border-l-[3px] py-4"
          style={{ borderLeftColor: color, background: tint(color, 10) }}
        >
          {open ? (
            <>
              <Hourglass size={20} className="text-muted" aria-hidden="true" />
              <span className="figures text-4xl font-semibold tracking-tight">{fmtHM(soFar)}</span>
              <span className="font-serif text-xs italic text-muted">{__("so far, open")}</span>
            </>
          ) : (
            <>
              <span className="figures text-4xl font-semibold tracking-tight">{fmtHM(Math.max(minutes * 60, 0))}</span>
              {crossesMidnight && minutes > 0 && (
                <span className="inline-flex items-center gap-1 font-serif text-xs italic text-muted">
                  <Moon size={12} />{" "}{__("started the day before")}</span>
              )}
            </>
          )}
        </div>

        <fieldset>
          <legend className={labelClass}>{open ? __("Day it started") : __("Day it ended")}</legend>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <DayChip active={isToday} onClick={() => setDay(today)}>{__("Today")}</DayChip>
            <DayChip
              active={isYesterday}
              onClick={() => setDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1))}
            >{__("Yesterday")}</DayChip>
            <label className="flex items-center gap-2">
              <span className="sr-only">{__("Pick another day")}</span>
              <input
                type="date"
                value={toDateInput(open ? start : end)}
                max={toDateInput(today)}
                onChange={(e) => e.target.value && setDay(new Date(`${e.target.value}T00:00:00`))}
                className={`figures h-7 border-0 border-b-2 bg-transparent text-[13px] outline-none ${
                  isToday || isYesterday ? "border-transparent text-muted" : "border-text"
                }`}
              />
            </label>
          </div>
        </fieldset>

        <div className={`grid gap-x-4 ${open ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-3"}`}>
          <label>
            <span className={labelClass}>
              {__("Start")}{" "}
              <button
                type="button"
                onClick={startNow}
                className="ml-1 font-normal text-accent-2 underline underline-offset-2 hover:text-text"
                title={__("Start now: a duration then sets where it ends")}
              >{__("now")}</button>
            </span>
            <input {...field("start")} inputMode="text" autoComplete="off" placeholder="9:00" className={timeFieldClass} />
          </label>
          {!open && (
            <>
              <label>
                <span className={labelClass}>
                  {__("End")}{" "}
                  <button
                    type="button"
                    onClick={endNow}
                    className="ml-1 font-normal text-accent-2 underline underline-offset-2 hover:text-text"
                  >{__("now")}</button>
                </span>
                <input {...field("end")} inputMode="text" autoComplete="off" placeholder="10:30" className={timeFieldClass} />
              </label>
              <label>
                <span className={labelClass}>{__("Duration")}</span>
                <input {...field("duration")} inputMode="text" autoComplete="off" placeholder={__("1h 30m")} className={timeFieldClass} />
              </label>
            </>
          )}
        </div>
        {!open && <p className="-mt-2 text-xs text-faint">{__("Type times like 9, 9:30 or 5pm, and durations like 90, 1h30 or 1.5h.")}</p>}

        {canOpen && (
          <label className="flex cursor-pointer items-start gap-2.5 border border-dashed border-line-strong px-3 py-2.5">
            <input
              type="checkbox"
              checked={open}
              onChange={(e) => toggleOpen(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 cursor-pointer accent-(--text)"
            />
            <span className="text-[13px]">
              <span className="font-semibold">{openItem ? __("Still going: keep it open") : __("Still going: leave it open")}</span>
              <span className="block text-xs text-muted">
                {openItem
                  ? __("Switch this off to close it at the end below; it becomes a session.")
                  : __("For long work: it counts up from the start, alongside the timer, until you close it.")}
              </span>
            </span>
          </label>
        )}

        {!open && (
          <div>
            <span className={labelClass}>{__("Quick duration")}</span>
            <div className="grid grid-cols-4 border-t border-l border-rule sm:grid-cols-8">
              {QUICK_MINUTES.map((m) => {
                const active = minutes === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDuration(m)}
                    aria-pressed={active}
                    className={`figures h-9 border-r border-b border-rule text-[13px] font-semibold transition-colors ${
                      active ? "bg-text text-bg" : "text-muted hover:bg-surface-2 hover:text-text"
                    }`}
                  >
                    {fmtHM(m * 60)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {inFuture && (
          <p className="flex items-start gap-2 text-[13px] text-danger">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" />
            <span>
              {open ? __("That starts in the future")
                : canOpen && anchor === "start" ? __("That ends in the future. Pick a shorter duration or End → now, or tick “Still going” to count up from the start.")
                : __("That ends in the future")}
            </span>
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function DayChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-7 items-center border-b-2 text-[13px] transition-colors ${
        active ? "border-text text-text" : "border-transparent text-muted hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}
