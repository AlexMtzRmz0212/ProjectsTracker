import { daySeconds, dayKey, fmtHM } from "../lib/time";

// Tile dividers: two columns on phones, four in a row from lg.
const TILE_EDGES = [
  "border-r border-b lg:border-b-0",
  "border-b lg:border-r lg:border-b-0",
  "border-r",
  "",
];

function Tile({ index, label, value, unit, children }) {
  return (
    <div className={`min-w-0 border-rule py-3.5 pr-4 ${index % 2 ? "pl-4" : "lg:pl-4 lg:first:pl-0"} ${TILE_EDGES[index]}`}>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="figures text-[26px] leading-tight font-semibold">{value}</span>
        {unit && <span className="font-serif text-[13px] italic text-muted">{unit}</span>}
      </div>
      <div className="mt-2 flex h-3.5 items-end">{children}</div>
    </div>
  );
}

/** Horizontal bar split by project ink, proportional to time. A hairline when empty. */
export function SplitBar({ byProject, projectsById, className = "h-1.5" }) {
  const entries = [...(byProject?.entries() ?? [])].filter(([id]) => projectsById.has(id));
  const total = entries.reduce((sum, [, secs]) => sum + secs, 0);
  if (total === 0) return <div className="h-px w-full bg-rule" />;
  return (
    <div className={`flex w-full gap-px ${className}`}>
      {entries.map(([id, secs]) => (
        <div
          key={id}
          title={`${projectsById.get(id).name}, ${fmtHM(secs)}`}
          style={{ width: `${(secs / total) * 100}%`, background: projectsById.get(id).color }}
        />
      ))}
    </div>
  );
}

export default function StatsStrip({ byDay, today, weekStart, streakDays, projects, projectsById, runningProjectId }) {
  const todayEntry = byDay.get(dayKey(today));
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i);
    return { date: d, secs: daySeconds(byDay, d), isToday: dayKey(d) === dayKey(today), future: d > today };
  });
  const weekTotal = week.reduce((sum, d) => sum + d.secs, 0);
  const weekMax = Math.max(...week.map((d) => d.secs), 1);
  const lastSeven = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + i);
    return { date: d, on: daySeconds(byDay, d) >= 60 };
  });
  const active = projects.filter((p) => p.status === "active");

  return (
    <section className="grid grid-cols-2 border-b border-line lg:grid-cols-4">
      <Tile index={0} label="Today" value={fmtHM(todayEntry?.total ?? 0)}>
        <SplitBar byProject={todayEntry?.byProject} projectsById={projectsById} />
      </Tile>

      <Tile index={1} label="This week" value={fmtHM(weekTotal)}>
        <div className="flex h-full w-full items-end gap-1">
          {week.map(({ date, secs, isToday, future }) => (
            <div
              key={dayKey(date)}
              className="flex-1"
              title={`${date.toDateString()}, ${fmtHM(secs)}`}
              style={{
                height: secs ? `${Math.max((secs / weekMax) * 100, 12)}%` : "1px",
                background: isToday && secs ? "var(--accent)" : secs ? "color-mix(in srgb, var(--text) 45%, transparent)" : future ? "var(--rule)" : "var(--faint)",
              }}
            />
          ))}
        </div>
      </Tile>

      <Tile index={2} label="Streak" value={streakDays} unit={streakDays === 1 ? "day" : "days"}>
        {/* Last seven days as a punched time card; today is the right-most hole */}
        <div className="flex items-center gap-1">
          {lastSeven.map(({ date, on }, i) => (
            <span
              key={i}
              title={`${date.toDateString()}${on ? ", logged" : ""}`}
              className={`size-2.5 ${on ? (i === 6 ? "bg-accent" : "bg-text") : "border border-line-strong"}`}
            />
          ))}
        </div>
      </Tile>

      <Tile index={3} label="Active" value={active.length} unit={active.length === 1 ? "project" : "projects"}>
        <div className="flex flex-wrap items-center gap-1.5 overflow-hidden">
          {active.length === 0 && <span className="h-px w-full bg-rule" />}
          {active.slice(0, 12).map((p) => (
            <span
              key={p.id}
              title={p.name}
              className={`size-2.5 ${p.id === runningProjectId ? "blink-dot outline-2 outline-offset-1" : ""}`}
              style={{ background: p.color, outlineColor: p.color }}
            />
          ))}
        </div>
      </Tile>
    </section>
  );
}
