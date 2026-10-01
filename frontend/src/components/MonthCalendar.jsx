import { useMemo } from "react";
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { tint } from "../lib/palette";
import { dayKey, fmtHM, fmtShort } from "../lib/time";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const MIN_SCALE = 2 * 3600; // a day "fills" at the month's busiest day, but never below 2h

export default function MonthCalendar({ cursor, onCursor, selected, onSelect, byDay, projectsById, today }) {
  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }),
        end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }),
      }),
    [cursor]
  );

  const inMonth = days.filter((d) => isSameMonth(d, cursor));
  const totals = inMonth.map((d) => byDay.get(dayKey(d))?.total ?? 0);
  const monthTotal = totals.reduce((a, b) => a + b, 0);
  const activeDays = totals.filter((t) => t >= 60).length;
  const scale = Math.max(MIN_SCALE, ...totals);
  const todayKey = dayKey(today);
  const selectedKey = dayKey(selected);

  return (
    <section>
      <div className="flex items-center gap-2">
        <h2 className="font-serif text-[17px] font-semibold">
          {format(cursor, "MMMM")} <span className="figures font-normal text-muted">{format(cursor, "yyyy")}</span>
        </h2>
        <div className="ml-auto flex items-center">
          <NavButton label="Previous month" onClick={() => onCursor(addMonths(cursor, -1))}>
            <ChevronLeft size={17} />
          </NavButton>
          <button
            onClick={() => {
              onCursor(today);
              onSelect(today);
            }}
            className="h-8 px-2.5 text-[13px] font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            Today
          </button>
          <NavButton label="Next month" onClick={() => onCursor(addMonths(cursor, 1))}>
            <ChevronRight size={17} />
          </NavButton>
        </div>
      </div>
      <p className="font-serif text-xs italic text-muted">
        {fmtHM(monthTotal)} this month, {activeDays} active {activeDays === 1 ? "day" : "days"}
      </p>

      <div className="mt-3 mb-1 grid grid-cols-7 text-center text-[11px] text-faint">
        {WEEKDAYS.map((w, i) => (
          <div key={i}>{w}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 border-t border-l border-rule">
        {days.map((d) => {
          const key = dayKey(d);
          const entry = byDay.get(key);
          const total = entry?.total ?? 0;
          const fill = Math.min(total / scale, 1) * 100;
          const outside = !isSameMonth(d, cursor);
          const isToday = key === todayKey;
          const isSelected = key === selectedKey;
          const segments = [...(entry?.byProject.entries() ?? [])].filter(([id]) => projectsById.has(id));

          return (
            <button
              key={key}
              onClick={() => onSelect(d)}
              aria-label={`${format(d, "EEEE, MMMM d")}: ${fmtHM(total)}`}
              aria-pressed={isSelected}
              className={`relative h-12 border-r border-b border-rule text-left transition-colors hover:bg-surface-2 sm:h-[52px] ${
                outside ? "opacity-45" : ""
              } ${isSelected ? "outline-2 -outline-offset-2 outline-text" : ""}`}
            >
              {/* ink wash: height = time worked, stacked by project ink */}
              {total > 0 && (
                <div className="absolute inset-x-0 bottom-0 flex flex-col-reverse" style={{ height: `${fill}%` }}>
                  {segments.map(([id, secs]) => (
                    <div
                      key={id}
                      style={{ height: `${(secs / total) * 100}%`, background: tint(projectsById.get(id).color, 42) }}
                    />
                  ))}
                </div>
              )}
              <span
                className={`figures absolute top-1 left-1.5 text-xs ${
                  isToday ? "font-bold text-accent underline decoration-2 underline-offset-[3px]" : ""
                }`}
              >
                {d.getDate()}
              </span>
              {total >= 60 && (
                <span className="figures absolute right-1 bottom-0.5 hidden text-[11px] font-semibold sm:block">
                  {fmtShort(total)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function NavButton({ label, onClick, children }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="grid size-8 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
    >
      {children}
    </button>
  );
}
