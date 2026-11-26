import { useMemo, useState } from "react";
import { Check, Merge } from "lucide-react";
import { todoSubject } from "../api";
import { countTags, dayKey, fmtHM, fmtShort } from "../lib/time";
import { N_, __, _n } from "../i18n";


const DAYS = 30; // the window of "where the time went"
const RHYTHM_WEEKS = 12; // the window of the weekday rhythm
const WEEKDAYS = [N_("Mon"), N_("Tue"), N_("Wed"), N_("Thu"), N_("Fri"), N_("Sat"), N_("Sun")];
const SHOWN_PROJECTS = 6;

const daysBack = (today, n) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);

/** Where the last 30 days went: the projects worked on, longest first, as bars in their own ink. */
export function ProjectTime({ byDay, projectsById, today, onOpenProject }) {
  const rows = useMemo(() => {
    const totals = new Map();
    for (let i = 0; i < DAYS; i++) {
      const day = byDay.get(dayKey(daysBack(today, i)));
      if (!day) continue;
      for (const [id, secs] of day.byProject) {
        if (projectsById.has(id)) totals.set(id, (totals.get(id) ?? 0) + secs);
      }
    }
    return [...totals].filter(([, secs]) => secs >= 60).sort((a, b) => b[1] - a[1]);
  }, [byDay, projectsById, today]);

  const shown = rows.slice(0, SHOWN_PROJECTS);
  const rest = rows.slice(SHOWN_PROJECTS).reduce((sum, [, secs]) => sum + secs, 0);
  const max = Math.max(...shown.map(([, secs]) => secs), 1);

  return (
    <section>
      <h2 className="font-hand text-[26px] font-semibold leading-none">{__("Where the time went")}</h2>
      <p className="font-serif text-[13px] italic text-muted">{__("The last {n} days.", { n: DAYS })}</p>
      {shown.length === 0 ? (
        <p className="mt-3 font-serif text-[13px] italic text-faint">{__("Nothing logged yet.")}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {shown.map(([id, secs]) => {
            const project = projectsById.get(id);
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onOpenProject(id)}
                  className="group block w-full text-left"
                  title={`${project.name}, ${fmtHM(secs)}`}
                >
                  <span className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="min-w-0 truncate group-hover:underline">{project.name}</span>
                    <span className="figures shrink-0 text-xs text-muted">{fmtHM(secs)}</span>
                  </span>
                  <span className="mt-1 block h-1.5 bg-surface-2">
                    <span className="block h-full" style={{ width: `${(secs / max) * 100}%`, background: project.color }} />
                  </span>
                </button>
              </li>
            );
          })}
          {rest > 0 && (
            <li className="flex justify-between font-serif text-xs italic text-muted">
              <span>{__("{n} more", { n: rows.length - SHOWN_PROJECTS })}</span>
              <span className="figures">{fmtHM(rest)}</span>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

const TOP_TODOS = 3;

/**
 * The three projects or tasks with the most to-dos still to do (sub-to-dos counted), and the three with the most to-dos
 * finished in the last 30 days, each as bars in its own ink. Opening one opens it in the side peek. `todos` is every to-do;
 * a to-do belongs to its project, or to its task (a task and its sub-tasks count for that task).
 */
export function TopTodos({ todos, projectsById, today, onOpenProject }) {
  const { pending, finished } = useMemo(() => {
    const from = daysBack(today, DAYS - 1);
    const pending = new Map();
    const finished = new Map();
    const bump = (map, id) => map.set(id, (map.get(id) ?? 0) + 1);
    for (const todo of todos) {
      if (todo.cancelled_at) continue;
      const id = todoSubject(todo);
      const subject = projectsById.get(id);
      if (!subject) continue;
      if (!todo.done) {
        if (!subject.archived_at) bump(pending, id);
      } else if (todo.completed_at && new Date(todo.completed_at) >= from) {
        bump(finished, id);
      }
    }
    const top = (map) => [...map].sort((a, b) => b[1] - a[1]).slice(0, TOP_TODOS);
    return { pending: top(pending), finished: top(finished) };
  }, [todos, projectsById, today]);

  const list = (rows, empty) =>
    rows.length === 0 ? (
      <p className="mt-2 font-serif text-[13px] italic text-faint">{empty}</p>
    ) : (
      <ul className="mt-2 flex flex-col gap-2">
        {rows.map(([id, count]) => {
          const subject = projectsById.get(id);
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => onOpenProject(id)}
                className="group block w-full text-left"
                title={`${subject.name}: ${_n(count, "{n} to-do", "{n} to-dos")}`}
              >
                <span className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate group-hover:underline">{subject.name}</span>
                  <span className="figures shrink-0 text-xs text-muted">{count}</span>
                </span>
                <span className="mt-1 block h-1.5 bg-surface-2">
                  <span className="block h-full" style={{ width: `${(count / rows[0][1]) * 100}%`, background: subject.color }} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );

  return (
    <section>
      <h2 className="font-hand text-[26px] font-semibold leading-none">{__("Most to do")}</h2>
      <p className="font-serif text-[13px] italic text-muted">{__("Open to-dos and sub-to-dos, by project or task.")}</p>
      {list(pending, __("Nothing left to do."))}
      <h2 className="mt-5 font-hand text-[26px] font-semibold leading-none">{__("Most done")}</h2>
      <p className="font-serif text-[13px] italic text-muted">{__("To-dos and sub-to-dos finished, the last {n} days.", { n: DAYS })}</p>
      {list(finished, __("Nothing finished yet."))}
    </section>
  );
}

/** Which weekdays carry the work: the average time logged on each, over the last twelve weeks. */
export function WeekdayRhythm({ byDay, today }) {
  const averages = useMemo(() => {
    const totals = Array(7).fill(0);
    for (let i = 0; i < RHYTHM_WEEKS * 7; i++) {
      const d = daysBack(today, i);
      totals[(d.getDay() + 6) % 7] += byDay.get(dayKey(d))?.total ?? 0;
    }
    return totals.map((secs) => secs / RHYTHM_WEEKS);
  }, [byDay, today]);
  const top = Math.max(...averages);
  const max = Math.max(top, 1);
  const todayIndex = (today.getDay() + 6) % 7;

  return (
    <section>
      <h2 className="font-hand text-[26px] font-semibold leading-none">{__("Weekday rhythm")}</h2>
      <p className="font-serif text-[13px] italic text-muted">
        {top < 60 ? __("Average a day, {RHYTHM_WEEKS} weeks.", { RHYTHM_WEEKS }) : __("Busiest on {value}s. Average a day, {RHYTHM_WEEKS} weeks.", { value: __(WEEKDAYS[averages.indexOf(top)]), RHYTHM_WEEKS })}
      </p>
      <div className="mt-3 grid grid-cols-7 gap-1.5">
        {averages.map((secs, i) => (
          <div key={WEEKDAYS[i]} className="flex flex-col items-center gap-1" title={__("{value}: {fmtHM} a day", { value: __(WEEKDAYS[i]), fmtHM: fmtHM(secs) })}>
            <span className="figures h-4 text-[10px] text-muted">{secs >= 60 ? fmtShort(secs) : ""}</span>
            <div className="flex h-20 w-full items-end bg-surface-2">
              <div
                className="w-full"
                style={{
                  height: secs >= 60 ? `${Math.max((secs / max) * 100, 6)}%` : "1px",
                  background: i === todayIndex ? "var(--accent)" : "color-mix(in srgb, var(--text) 45%, transparent)",
                }}
              />
            </div>
            <span className={`text-[11px] ${i === todayIndex ? "font-semibold text-text" : "text-faint"}`}>{__(WEEKDAYS[i])}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

const SHOWN_TAGS = 40; // chips drawn in the tag cloud

/**
 * What the pomodoros of the last 30 days were tagged as, as a cloud: the more a tag was used, the bigger it is. Not drawn
 * until one has a tag. Tags that are the same thing written differently can be merged: "Merge" lets you tick them and
 * pick which name to keep (`onMerge(labels, into)` renames them, resolving to whether it worked). It renames them in every
 * pomodoro, not only the last 30 days, and can't be undone.
 */
export function PomodoroTags({ pomodoros, today, onMerge }) {
  const rows = useMemo(() => {
    const from = daysBack(today, DAYS - 1);
    return countTags(pomodoros.filter((p) => p.start >= from));
  }, [pomodoros, today]);
  const [merging, setMerging] = useState(false);
  const [ticked, setTicked] = useState([]); // the labels ticked to merge
  const [keep, setKeep] = useState(null); // the one of them whose name stays
  const [busy, setBusy] = useState(false);
  if (rows.length === 0) return null;
  const shown = rows.slice(0, SHOWN_TAGS);
  const max = Math.max(...shown.map(([, n]) => n), 1);
  const counts = new Map(rows);
  // Ticks that are no longer tags (merged away, or out of the 30 days) are dropped
  const chosen = ticked.filter((label) => counts.has(label));
  const name = chosen.includes(keep) ? keep : chosen[0]; // the most used of them stays unless another is picked

  const stop = () => {
    setMerging(false);
    setTicked([]);
    setKeep(null);
  };
  const tick = (label) => setTicked((prev) => (prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label]));
  const merge = async () => {
    setBusy(true);
    const ok = await onMerge(chosen, name);
    setBusy(false);
    if (ok) stop();
  };

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-hand text-[26px] font-semibold leading-none">{__("Pomodoro tags")}</h2>
        {onMerge && rows.length > 1 && (
          <button
            type="button"
            onClick={() => (merging ? stop() : setMerging(true))}
            aria-pressed={merging}
            className={`inline-flex h-7 shrink-0 items-center gap-1.5 border px-2 text-xs font-semibold transition-colors hover:border-text hover:bg-surface-2 ${merging ? "border-text bg-surface-2" : "border-line-strong"}`}
            title={__("Merge tags that mean the same thing")}
          >
            <Merge size={12} aria-hidden="true" />
            {merging ? __("Done") : __("Merge")}
          </button>
        )}
      </div>
      <p className="font-serif text-[13px] italic text-muted">
        {merging ? (chosen.length === 1 ? __("Tick at least one more tag that is the same thing.") : __("Tick two or more tags that are the same thing. Then pick the name to keep and merge.")) :__("What the focuses were for, the last {n} days. Bigger is more.", { n: DAYS })}
      </p>
      <ul className="mt-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5">
        {shown.map(([label, count]) => {
          const on = chosen.includes(label);
          const size = 12 + Math.round((count / max) * 10); // 12 to 22 px
          const title = `${label}: ${_n(count, "{n} pomodoro", "{n} pomodoros")}`;
          return (
            <li key={label}>
              {merging ? (
                <button
                  type="button"
                  onClick={() => tick(label)}
                  aria-pressed={on}
                  title={title}
                  style={{ fontSize: size }}
                  className={`inline-flex max-w-full items-center gap-1.5 border-2 px-1.5 py-0.5 leading-tight transition-colors ${
                    on ? "border-accent bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] font-semibold text-text" : "border-line-strong text-muted hover:border-text hover:text-text"
                  }`}
                >
                  <span
                    className={`grid size-3.5 shrink-0 place-items-center border ${on ? "border-accent bg-accent text-bg" : "border-line-strong"}`}
                    aria-hidden="true"
                  >
                    {on && <Check size={11} strokeWidth={3.5} />}
                  </span>
                  <span className="truncate">{label}</span>
                  <sup className="figures text-[10px] text-muted">{count}</sup>
                </button>
              ) : (
                <span title={title} style={{ fontSize: size }} className="inline-flex max-w-full items-baseline gap-0.5 leading-tight">
                  <span className="truncate">{label}</span>
                  <sup className="figures text-[10px] text-muted">{count}</sup>
                </span>
              )}
            </li>
          );
        })}
        {rows.length > shown.length && <li className="font-serif text-xs italic text-muted">{__("{n} more", { n: rows.length - shown.length })}</li>}
      </ul>

      {merging && chosen.length > 1 && (
        <div className="mt-3 border border-line-strong p-2.5">
          <p className="text-xs font-semibold text-muted">{__("Keep this name")}</p>
          <div role="radiogroup" aria-label={__("Keep this name")} className="mt-1 flex flex-col">
            {chosen.map((label) => (
              <label key={label} className="flex min-h-8 cursor-pointer items-center gap-2 text-[13px]">
                <input type="radio" name="keep-tag" checked={name === label} onChange={() => setKeep(label)} className="accent-(--text)" />
                <span className="min-w-0 flex-1 truncate">{label}</span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-faint">{__("Every pomodoro with these tags is renamed, not only the last {n} days. This can't be undone.", { n: DAYS })}</p>
          <button
            type="button"
            onClick={merge}
            disabled={busy}
            className="mt-2 inline-flex h-8 items-center gap-1.5 border border-text bg-text px-3 text-xs font-semibold text-bg transition-opacity disabled:opacity-50"
          >
            <Merge size={12} aria-hidden="true" />
            {__("Merge {n} tags into “{name}”", { n: chosen.length, name })}
          </button>
        </div>
      )}
    </section>
  );
}
