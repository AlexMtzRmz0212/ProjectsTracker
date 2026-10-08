import { useState } from "react";
import { Check, Hourglass, Moon, Trash2, TriangleAlert } from "lucide-react";
import Modal, { Button } from "./Modal";
import { iconFor, inkText, tint } from "../lib/palette";
import {
  dayKey, fmtDurationInput, fmtHM, parseClock, parseDuration, toDateInput, toTimeInput,
} from "../lib/time";

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
 * You say when it ended and how long it lasted; the start follows. Type any of the
 * three (start, end, duration) and the others keep up: start and end give the
 * duration, a duration moves the start. The end is the anchor because time is
 * usually logged just after the fact ("2h, finished now"), so one tap on a chip does it.
 *
 * "Leave it open" turns it into an open item: only the start is kept, and it runs (alongside the timer)
 * until it is closed. Start → now does that from this moment. `openItem` edits one that is open: keep it
 * open, or switch it off to close it at the end given. `projects` are the subjects time can go on: open
 * projects and tasks.
 */
export default function SessionModal({
  session, openItem, projectId, date, span, startOpen = false, projects, onClose, onSave, onDelete, onSaveOpen, onCloseOpen,
}) {
  const first = initialSpan(session, openItem, date, span);
  const [pid, setPid] = useState(session?.project_id ?? openItem?.project_id ?? projectId ?? projects[0]?.id);
  const [start, setStart] = useState(startOpen ? flooredMinute(new Date()) : first.start);
  const [end, setEnd] = useState(first.end);
  const [note, setNote] = useState(session?.note ?? openItem?.note ?? "");
  const [open, setOpen] = useState(Boolean(openItem) || startOpen);
  const [saving, setSaving] = useState(false);
  // The field being typed in keeps its raw text; the others are shown from start and end
  const [typing, setTyping] = useState({ field: null, text: "" });

  const canOpen = Boolean(onSaveOpen) && !session; // a session already logged stays a session
  const project = projects.find((p) => p.id === pid);
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

  // ── Edits. Each keeps one end fixed and moves the rest ──────────────────────

  const setEndTime = (m) => {
    // The end keeps its day; a time before the start can only mean the next day
    let next = atMinute(end, m);
    if (next <= start) next = new Date(next.getTime() + DAY);
    setEnd(next);
  };
  const setStartTime = (m) => {
    if (open) return setStart(atMinute(start, m)); // nothing to keep before: the start keeps its day
    // The start is the latest moment with that clock time before the end
    let next = atMinute(end, m);
    if (next >= end) next = new Date(next.getTime() - DAY);
    setStart(next);
  };
  const setDuration = (mins) => setStart(new Date(end.getTime() - mins * MINUTE));
  const setDay = (day) => {
    if (open) return setStart(atMinute(day, start.getHours() * 60 + start.getMinutes()));
    const shift = atMinute(day, end.getHours() * 60 + end.getMinutes()) - end;
    setStart(new Date(start.getTime() + shift));
    setEnd(new Date(end.getTime() + shift));
  };
  const endNow = () => {
    const now = flooredMinute(new Date());
    setStart(new Date(now.getTime() - Math.max(minutes, 1) * MINUTE));
    setEnd(now);
  };
  /** Starting now can't end yet: it is left open. */
  const startNow = () => {
    setStart(flooredMinute(new Date()));
    setOpen(true);
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
    const data = { project_id: pid, start, note: note.trim() };
    const ok =
      open ? await onSaveOpen(openItem, data)
      : openItem ? await onCloseOpen(openItem, { ...data, end })
      : await onSave({ ...data, end });
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Modal
      title={openItem ? "Open item" : session ? "Edit session" : open ? "Start something open" : "Add time"}
      onClose={onClose}
      footer={
        <>
          {(session || openItem) && (
            <Button variant="danger" onClick={() => onDelete(session ?? openItem)}>
              <Trash2 size={15} /> <span className="hidden sm:inline">{openItem ? "Discard" : "Delete"}</span>
            </Button>
          )}
          <Button className="ml-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!valid || saving}>
            <Check size={16} /> {openItem && !open ? "Close it" : open && !openItem ? "Start" : "Save"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <fieldset>
          <legend className={labelClass}>Project or task</legend>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Project or task">
            {projects.map((p) => {
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
                  } ${p.kind === "task" ? "border-dashed" : ""}`}
                  style={active ? { borderColor: p.color, background: tint(p.color, 14) } : undefined}
                >
                  <Icon size={15} style={{ color: inkText(p.color) }} className="shrink-0" />
                  <span className="truncate">{p.name}</span>
                </button>
              );
            })}
            {projects.length === 0 && <p className="text-[13px] text-muted">No open projects or tasks.</p>}
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
              <span className="font-serif text-xs italic text-muted">so far, open</span>
            </>
          ) : (
            <>
              <span className="figures text-4xl font-semibold tracking-tight">{fmtHM(Math.max(minutes * 60, 0))}</span>
              {crossesMidnight && minutes > 0 && (
                <span className="inline-flex items-center gap-1 font-serif text-xs italic text-muted">
                  <Moon size={12} /> started the day before
                </span>
              )}
            </>
          )}
        </div>

        <fieldset>
          <legend className={labelClass}>{open ? "Day it started" : "Day it ended"}</legend>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <DayChip active={isToday} onClick={() => setDay(today)}>
              Today
            </DayChip>
            <DayChip
              active={isYesterday}
              onClick={() => setDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1))}
            >
              Yesterday
            </DayChip>
            <label className="flex items-center gap-2">
              <span className="sr-only">Pick another day</span>
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
              Start{" "}
              {canOpen && (
                <button
                  type="button"
                  onClick={startNow}
                  className="ml-1 font-normal text-accent-2 underline underline-offset-2 hover:text-text"
                  title="Start it now and leave it open"
                >
                  now
                </button>
              )}
            </span>
            <input {...field("start")} inputMode="text" autoComplete="off" placeholder="9:00" className={timeFieldClass} />
          </label>
          {!open && (
            <>
              <label>
                <span className={labelClass}>
                  End{" "}
                  <button
                    type="button"
                    onClick={endNow}
                    className="ml-1 font-normal text-accent-2 underline underline-offset-2 hover:text-text"
                  >
                    now
                  </button>
                </span>
                <input {...field("end")} inputMode="text" autoComplete="off" placeholder="10:30" className={timeFieldClass} />
              </label>
              <label>
                <span className={labelClass}>Duration</span>
                <input {...field("duration")} inputMode="text" autoComplete="off" placeholder="1h 30m" className={timeFieldClass} />
              </label>
            </>
          )}
        </div>
        {!open && <p className="-mt-2 text-xs text-faint">Type times like 9, 9:30 or 5pm, and durations like 90, 1h30 or 1.5h.</p>}

        {canOpen && (
          <label className="flex cursor-pointer items-start gap-2.5 border border-dashed border-line-strong px-3 py-2.5">
            <input
              type="checkbox"
              checked={open}
              onChange={(e) => toggleOpen(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 cursor-pointer accent-(--text)"
            />
            <span className="text-[13px]">
              <span className="font-semibold">{openItem ? "Still going: keep it open" : "Still going: leave it open"}</span>
              <span className="block text-xs text-muted">
                {openItem
                  ? "Switch this off to close it at the end below; it becomes a session."
                  : "For long work: it counts up from the start, alongside the timer, until you close it."}
              </span>
            </span>
          </label>
        )}

        {!open && (
          <div>
            <span className={labelClass}>Quick duration</span>
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

        <label className="block">
          <span className={labelClass}>Note (optional)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={280}
            placeholder={open ? "Rendering the final cut" : "Outlined the methods section"}
            className={`${fieldClass} text-[14px]`}
          />
        </label>

        {inFuture && (
          <p className="flex items-center gap-2 text-[13px] text-danger">
            <TriangleAlert size={15} /> {open ? "That starts in the future" : "That ends in the future"}
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
