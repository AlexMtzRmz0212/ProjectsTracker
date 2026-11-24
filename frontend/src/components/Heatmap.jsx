import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "../lib/dates";
import ProjectMultiSelect from "./ProjectMultiSelect";
import { inkText } from "../lib/palette";
import { HEATMAP_WEEKS, dayKey, daySecondsOf, fmtHM, heatmapStart, weekMonday } from "../lib/time";
import { N_, __, _n, useT } from "../i18n";


// Intensity buckets (seconds). Level 0 = nothing logged.
const LEVELS = [30 * 60, 90 * 60, 3 * 3600];
const MIX = [0, 20, 38, 58, 80]; // % of the ink per level, like denser and denser marks

function levelOf(secs) {
  if (secs < 60) return 0;
  const idx = LEVELS.findIndex((limit) => secs < limit);
  return idx === -1 ? 4 : idx + 1;
}

function shade(level, color) {
  if (level === 0) return "var(--surface-2)";
  return `color-mix(in srgb, ${color} ${MIX[level]}%, var(--surface-2))`;
}

const CELL = 12; // the smallest a square gets before a week is dropped
const MAX_CELL = 22; // and the largest, when there are few weeks to show
const MIN_WEEKS = 12; // a young app still gets a quarter of a year to fill in
const GAP = 3;
const LABEL_COLUMN = 26;

/** `since` is the first day anything was logged (null if nothing yet): the heatmap starts at its week, not a year back. */
export default function Heatmap({ byDay, projects, projectsById, today, selected, since, onSelect }) {
  useT();
  const [filter, setFilter] = useState(() => new Set()); // the projects picked; none picked is all of them
  const [tip, setTip] = useState(null);
  const scroller = useRef(null);
  const [fit, setFit] = useState(HEATMAP_WEEKS);
  // Weeks from the one it began in to this one, within a quarter of a year and a year
  const span = useMemo(() => {
    if (!since) return MIN_WEEKS;
    const weeks = Math.round((weekMonday(today) - weekMonday(since)) / (7 * 86400000)) + 1;
    return Math.max(MIN_WEEKS, Math.min(HEATMAP_WEEKS, weeks));
  }, [since, today]);
  const shownWeeks = Math.min(fit, span);

  // Show as many weeks as fit across, newest on the right, so it never scrolls sideways
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      const room = el.clientWidth - LABEL_COLUMN + GAP;
      setFit(Math.max(8, Math.min(HEATMAP_WEEKS, Math.floor(room / (CELL + GAP)))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A project picked here may be gone from the list (archived, say): only the ones still there count
  const picked = useMemo(() => new Set([...filter].filter((id) => projectsById.has(id))), [filter, projectsById]);
  // All of them, or several, are drawn in plain ink; exactly one in its own ink.
  const only = picked.size === 1 ? projectsById.get([...picked][0]) : null;
  const color = only ? inkText(only.color) : "var(--text)";

  // Columns of Monday→Sunday weeks, oldest on the left.
  const weeks = useMemo(() => {
    const start = heatmapStart(today);
    return Array.from({ length: HEATMAP_WEEKS }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d))
    ).slice(-shownWeeks);
  }, [today, shownWeeks]);

  const stats = useMemo(() => {
    let total = 0;
    let active = 0;
    let best = { secs: 0, date: null };
    for (const week of weeks) {
      for (const d of week) {
        if (d > today) continue;
        const secs = daySecondsOf(byDay, d, picked);
        total += secs;
        if (secs >= 60) active++;
        if (secs > best.secs) best = { secs, date: d };
      }
    }
    return { total, active, best };
  }, [weeks, byDay, picked, today]);

  // The tooltip is position:fixed, so drop it as soon as anything scrolls.
  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", hide, { capture: true });
  }, [tip]);

  const selectedKey = dayKey(selected);
  const todayKey = dayKey(today);

  const showTip = (e, d, secs) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.top, text: `${format(d, "EEE, MMM d")}: ${fmtHM(secs)}` });
  };

  return (
    <section className="min-w-0 pt-4 pb-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-hand text-[26px] font-semibold leading-none">
          {shownWeeks < span
            ? __("The last {shownWeeks} weeks", { shownWeeks })
            : span === HEATMAP_WEEKS
              ? __("The past year")
              : since && weekMonday(since) > heatmapStart(today)
                ? __("Since {format}", { format: format(since, "d MMMM") })
                : __("The last {span} weeks", { span })}
        </h2>
        <p className="font-serif text-[13px] italic text-muted">
          {__("{time} logged. {days}.", { time: fmtHM(stats.total), days: _n(stats.active, "{n} active day", "{n} active days") })}
          {stats.best.date && ` ${__("Best day {time} on {date}.", { time: fmtHM(stats.best.secs), date: format(stats.best.date, "d MMMM") })}`}
        </p>
      </div>

      {projects.length > 0 && (
        <div className="mt-3">
          <ProjectMultiSelect projects={projects} selected={picked} onChange={setFilter} />
        </div>
      )}

      <div ref={scroller} className="mt-3" onMouseLeave={() => setTip(null)}>
        <div
          className="grid gap-[3px]"
          style={{
            gridTemplateColumns: `${LABEL_COLUMN}px repeat(${weeks.length}, minmax(0, ${MAX_CELL}px))`,
            gridTemplateRows: "14px repeat(7, auto)",
            gridAutoFlow: "column",
          }}
        >
          {/* weekday labels column */}
          <span />
          {[N_("Mon"), "", N_("Wed"), "", N_("Fri"), "", ""].map((l, i) => (
            <span key={i} className="self-center text-[10px] leading-none text-faint">
              {l ? __(l) : ""}
            </span>
          ))}

          {weeks.map((week, w) => {
            // Label the column that contains the 1st of a month
            const firstOfMonth = week.find((d) => d.getDate() === 1 && d <= today);
            return [
              <span key={`m${w}`} className="text-[10px] leading-none whitespace-nowrap text-faint">
                {firstOfMonth ? format(firstOfMonth, "MMM") : ""}
              </span>,
              ...week.map((d) => {
                const key = dayKey(d);
                if (d > today) return <span key={key} />;
                const secs = daySecondsOf(byDay, d, picked);
                const isSelected = key === selectedKey;
                return (
                  <button
                    key={key}
                    onClick={() => {
                      setTip(null);
                      onSelect(d);
                    }}
                    onMouseEnter={(e) => showTip(e, d, secs)}
                    onFocus={(e) => showTip(e, d, secs)}
                    onBlur={() => setTip(null)}
                    aria-label={`${format(d, "EEEE, MMMM d")}: ${fmtHM(secs)}`}
                    className={`aspect-square w-full rounded-[35%] hover:outline-1 hover:outline-text ${
                      isSelected ? "outline-2 outline-offset-1 outline-text" : key === todayKey ? "outline-1 outline-accent" : ""
                    }`}
                    style={{ background: shade(levelOf(secs), color) }}
                  />
                );
              }),
            ];
          })}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-end gap-1 text-[11px] text-faint">
        <span className="mr-0.5">{__("Less")}</span>
        {MIX.map((_, level) => (
          <span key={level} className="size-2.5 rounded-[35%]" style={{ background: shade(level, color) }} />
        ))}
        <span className="ml-0.5">{__("More")}</span>
      </div>

      {tip && (
        <div
          className="figures pointer-events-none fixed z-40 -translate-x-1/2 -translate-y-full bg-text px-2 py-1 text-xs whitespace-nowrap text-bg"
          style={{ left: tip.x, top: tip.y - 6 }}
        >
          {tip.text}
        </div>
      )}
    </section>
  );
}

