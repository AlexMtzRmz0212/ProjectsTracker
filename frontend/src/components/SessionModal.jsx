import { useState } from "react";
import { Check, Moon, Trash2, TriangleAlert } from "lucide-react";
import Modal, { Button } from "./Modal";
import { iconFor, inkText, tint } from "../lib/palette";
import { dayKey, fmtHM, fromInputs, toDateInput, toTimeInput } from "../lib/time";

const QUICK_MINUTES = [15, 30, 45, 60, 90, 120, 180, 240];
const fieldClass =
  "h-10 w-full min-w-0 border-0 border-b border-line-strong bg-transparent px-0 outline-none transition-colors focus:border-b-2 focus:border-accent-2 focus-visible:outline-none";
const timeFieldClass = `${fieldClass} figures text-[15px]`;
const labelClass = "mb-1 block text-xs font-semibold text-muted";

function initialTimes(session, date, now) {
  if (session) {
    return { date: toDateInput(session.start), start: toTimeInput(session.start), end: toTimeInput(session.end) };
  }
  if (dayKey(date) === dayKey(now)) {
    // Today: the hour that just ended, snapped to 5 minutes
    const end = new Date(now);
    end.setSeconds(0, 0);
    end.setMinutes(Math.floor(end.getMinutes() / 5) * 5);
    const start = new Date(end.getTime() - 3600_000);
    return { date: toDateInput(start), start: toTimeInput(start), end: toTimeInput(end) };
  }
  return { date: toDateInput(date), start: "09:00", end: "10:00" };
}

/** Log time after the fact, or edit an existing session. */
export default function SessionModal({ session, projectId, date, projects, now, onClose, onSave, onDelete }) {
  const init = initialTimes(session, date, now);
  const [pid, setPid] = useState(session?.project_id ?? projectId ?? projects[0]?.id);
  const [dateStr, setDateStr] = useState(init.date);
  const [startStr, setStartStr] = useState(init.start);
  const [endStr, setEndStr] = useState(init.end);
  const [note, setNote] = useState(session?.note ?? "");
  const [saving, setSaving] = useState(false);

  const project = projects.find((p) => p.id === pid);
  const color = project?.color ?? "var(--accent-2)";

  const filled = dateStr && startStr && endStr;
  const start = filled ? fromInputs(dateStr, startStr) : null;
  let end = filled ? fromInputs(dateStr, endStr) : null;
  // An end time at or before the start means the session ran past midnight
  const overnight = filled && end <= start;
  if (overnight) end = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1, end.getHours(), end.getMinutes());
  const duration = filled ? (end - start) / 1000 : 0;
  const inFuture = filled && end > new Date(Date.now() + 60_000);
  const valid = Boolean(project && filled && duration > 0 && !inFuture);

  const setDuration = (minutes) => {
    if (!start) return;
    setEndStr(toTimeInput(new Date(start.getTime() + minutes * 60_000)));
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    const ok = await onSave({ project_id: pid, start, end, note: note.trim() });
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Modal
      title={session ? "Edit session" : "Add time"}
      onClose={onClose}
      footer={
        <>
          {session && (
            <Button variant="danger" onClick={() => onDelete(session)}>
              <Trash2 size={15} /> <span className="hidden sm:inline">Delete</span>
            </Button>
          )}
          <Button className="ml-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!valid || saving}>
            <Check size={16} /> Save
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <fieldset>
          <legend className={labelClass}>Project</legend>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Project">
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
                  }`}
                  style={active ? { borderColor: p.color, background: tint(p.color, 14) } : undefined}
                >
                  <Icon size={15} style={{ color: inkText(p.color) }} className="shrink-0" />
                  <span className="truncate">{p.name}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* Big duration readout */}
        <div
          className="flex items-center justify-center gap-3 border-l-[3px] py-4"
          style={{ borderLeftColor: color, background: tint(color, 10) }}
        >
          <span className="figures text-4xl font-semibold tracking-tight">{fmtHM(Math.max(duration, 0))}</span>
          {overnight && (
            <span className="inline-flex items-center gap-1 font-serif text-xs italic text-muted">
              <Moon size={12} /> next day
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <label className="col-span-2 sm:col-span-1">
            <span className={labelClass}>Date</span>
            <input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} max={toDateInput(now)} className={timeFieldClass} />
          </label>
          <label>
            <span className={labelClass}>Start</span>
            <input type="time" value={startStr} onChange={(e) => setStartStr(e.target.value)} className={timeFieldClass} />
          </label>
          <label>
            <span className={labelClass}>End</span>
            <input type="time" value={endStr} onChange={(e) => setEndStr(e.target.value)} className={timeFieldClass} />
          </label>
        </div>

        <div>
          <span className={labelClass}>Quick duration</span>
          <div className="grid grid-cols-4 border-t border-l border-rule sm:grid-cols-8">
            {QUICK_MINUTES.map((m) => {
              const active = duration === m * 60;
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

        <label className="block">
          <span className={labelClass}>Note (optional)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={280}
            placeholder="Outlined the methods section"
            className={`${fieldClass} text-[14px]`}
          />
        </label>

        {inFuture && (
          <p className="flex items-center gap-2 text-[13px] text-danger">
            <TriangleAlert size={15} /> That ends in the future
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
