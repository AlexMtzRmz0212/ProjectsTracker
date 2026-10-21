import { useMemo } from "react";
import { dayKey, fmtHM, fmtShort } from "../lib/time";

const DAYS = 30; // the window of "where the time went"
const RHYTHM_WEEKS = 12; // the window of the weekday rhythm
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
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
      <h2 className="font-hand text-[26px] font-semibold leading-none">Where the time went</h2>
      <p className="font-serif text-[13px] italic text-muted">The last {DAYS} days.</p>
      {shown.length === 0 ? (
        <p className="mt-3 font-serif text-[13px] italic text-faint">Nothing logged yet.</p>
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
              <span>{rows.length - SHOWN_PROJECTS} more</span>
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
      <h2 className="font-hand text-[26px] font-semibold leading-none">Weekday rhythm</h2>
      <p className="font-serif text-[13px] italic text-muted">
        {top < 60 ? `Average a day, ${RHYTHM_WEEKS} weeks.` : `Busiest on ${WEEKDAYS[averages.indexOf(top)]}s. Average a day, ${RHYTHM_WEEKS} weeks.`}
      </p>
      <div className="mt-3 grid grid-cols-7 gap-1.5">
        {averages.map((secs, i) => (
          <div key={WEEKDAYS[i]} className="flex flex-col items-center gap-1" title={`${WEEKDAYS[i]}: ${fmtHM(secs)} a day`}>
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
            <span className={`text-[11px] ${i === todayIndex ? "font-semibold text-text" : "text-faint"}`}>{WEEKDAYS[i]}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
