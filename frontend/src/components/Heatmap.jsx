import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { iconFor, inkText } from "../lib/palette";
import { HEATMAP_WEEKS, dayKey, daySeconds, fmtHM, heatmapStart } from "../lib/time";

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

export default function Heatmap({ byDay, projects, projectsById, today, selected, onSelect }) {
  const [filter, setFilter] = useState("all");
  const [tip, setTip] = useState(null);
  const scroller = useRef(null);

  const filterProject = filter === "all" ? null : projectsById.get(filter);
  // "All" is drawn in plain ink; a filtered project in its own ink.
  const color = filterProject ? inkText(filterProject.color) : "var(--text)";

  // Columns of Monday→Sunday weeks, oldest on the left.
  const weeks = useMemo(() => {
    const start = heatmapStart(today);
    return Array.from({ length: HEATMAP_WEEKS }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d))
    );
  }, [today]);

  const stats = useMemo(() => {
    let total = 0;
    let active = 0;
    let best = { secs: 0, date: null };
    for (const week of weeks) {
      for (const d of week) {
        if (d > today) continue;
        const secs = daySeconds(byDay, d, filterProject?.id);
        total += secs;
        if (secs >= 60) active++;
        if (secs > best.secs) best = { secs, date: d };
      }
    }
    return { total, active, best };
  }, [weeks, byDay, filterProject, today]);

  // Start scrolled to the most recent weeks on narrow screens.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

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
    <section className="py-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-serif text-[17px] font-semibold">The past year</h2>
        <p className="font-serif text-[13px] italic text-muted">
          {fmtHM(stats.total)} logged. {stats.active} active {stats.active === 1 ? "day" : "days"}.
          {stats.best.date && ` Best day ${fmtHM(stats.best.secs)} on ${format(stats.best.date, "d MMMM")}.`}
        </p>
      </div>

      {projects.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1" role="radiogroup" aria-label="Filter by project">
          <FilterTab active={filter === "all"} onClick={() => setFilter("all")} color="var(--text)">
            All
          </FilterTab>
          {projects.map((p) => {
            const Icon = iconFor(p.icon);
            const ink = inkText(p.color);
            return (
              <FilterTab key={p.id} active={filter === p.id} onClick={() => setFilter(p.id)} color={ink} title={p.name}>
                <Icon size={13} style={{ color: ink }} />
                <span className="max-w-[9rem] truncate">{p.name}</span>
              </FilterTab>
            );
          })}
        </div>
      )}

      <div ref={scroller} className="mt-4 overflow-x-auto pb-1" onMouseLeave={() => setTip(null)}>
        <div
          className="grid min-w-[760px] gap-[3px]"
          style={{
            gridTemplateColumns: `26px repeat(${HEATMAP_WEEKS}, minmax(0, 1fr))`,
            gridTemplateRows: "14px repeat(7, auto)",
            gridAutoFlow: "column",
          }}
        >
          {/* weekday labels column */}
          <span />
          {["Mon", "", "Wed", "", "Fri", "", ""].map((l, i) => (
            <span key={i} className="self-center text-[10px] leading-none text-faint">
              {l}
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
                const secs = daySeconds(byDay, d, filterProject?.id);
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
                    className={`aspect-square w-full hover:outline-1 hover:outline-text ${
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

      <div className="mt-3 flex items-center justify-end gap-1 text-[11px] text-faint">
        <span className="mr-0.5">Less</span>
        {MIX.map((_, level) => (
          <span key={level} className="size-2.5" style={{ background: shade(level, color) }} />
        ))}
        <span className="ml-0.5">More</span>
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

function FilterTab({ active, onClick, color, title, children }) {
  return (
    <button
      role="radio"
      aria-checked={active}
      onClick={onClick}
      title={title}
      className={`inline-flex h-7 items-center gap-1.5 border-b-2 text-[13px] transition-colors ${
        active ? "text-text" : "border-transparent text-muted hover:text-text"
      }`}
      style={active ? { borderColor: color } : undefined}
    >
      {children}
    </button>
  );
}
