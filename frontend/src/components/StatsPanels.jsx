import { useMemo } from "react";
import { countTags, dayKey, fmtHM, fmtShort } from "../lib/time";
import { N_, __, useT } from "../i18n";


const DAYS = 30; // the window of "where the time went"
const RHYTHM_WEEKS = 12; // the window of the weekday rhythm
const WEEKDAYS = [N_("Mon"), N_("Tue"), N_("Wed"), N_("Thu"), N_("Fri"), N_("Sat"), N_("Sun")];
const SHOWN_PROJECTS = 6;

const daysBack = (today, n) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);

/** Where the last 30 days went: the projects worked on, longest first, as bars in their own ink. */
export function ProjectTime({ byDay, projectsById, today, onOpenProject }) {
  useT();
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

/** Which weekdays carry the work: the average time logged on each, over the last twelve weeks. */
export function WeekdayRhythm({ byDay, today }) {
  useT();
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

/** What the pomodoros of the last 30 days were tagged as, most used first. Not drawn until one has a tag. */
export function PomodoroTags({ pomodoros, today }) {
  useT();
  const rows = useMemo(() => {
    const from = daysBack(today, DAYS - 1);
    return countTags(pomodoros.filter((p) => p.start >= from));
  }, [pomodoros, today]);
  if (rows.length === 0) return null;
  const shown = rows.slice(0, SHOWN_PROJECTS);
  const max = Math.max(...shown.map(([, n]) => n), 1);

  return (
    <section>
      <h2 className="font-hand text-[26px] font-semibold leading-none">{__("Pomodoro tags")}</h2>
      <p className="font-serif text-[13px] italic text-muted">{__("What the focuses were for, the last {n} days.", { n: DAYS })}</p>
      <ul className="mt-3 flex flex-col gap-2">
        {shown.map(([label, count]) => (
          <li key={label} title={`${label}: ${count} ${count === 1 ? "pomodoro" : "pomodoros"}`}>
            <span className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate">{label}</span>
              <span className="figures shrink-0 text-xs text-muted">{count}</span>
            </span>
            <span className="mt-1 block h-1.5 bg-surface-2">
              <span className="block h-full bg-accent" style={{ width: `${(count / max) * 100}%` }} />
            </span>
          </li>
        ))}
        {rows.length > shown.length && (
          <li className="font-serif text-xs italic text-muted">{__("{n} more", { n: rows.length - shown.length })}</li>
        )}
      </ul>
    </section>
  );
}
