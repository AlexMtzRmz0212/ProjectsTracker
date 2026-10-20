import { iconFor, inkText, tint } from "../lib/palette";
import { todoSubject } from "../api";

/** The to-dos ticked off in a day as bars, one per project or task, longest first. `ticked` is the day's
 *  to-dos that DayPanel already lists; nothing is drawn for a day with none. */
export default function DoneChart({ ticked, projectsById }) {
  const counts = new Map();
  for (const x of ticked) {
    const id = todoSubject(x);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const rows = [...counts].sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return null;
  const most = rows[0][1];

  return (
    <div className="mt-5">
      <h3 className="flex items-baseline gap-2 border-b border-rule py-1 text-left font-serif text-xs font-normal italic text-muted">
        Done <span className="figures not-italic">{ticked.length}</span>
      </h3>
      <ul className="mt-2 space-y-1.5">
        {rows.map(([id, count]) => {
          const project = projectsById.get(id);
          const Icon = iconFor(project.icon);
          const name = project.name;
          return (
            <li key={id} className="flex items-center gap-2 text-[13px]" title={`${name}: ${count} done`}>
              <Icon size={14} className="shrink-0" style={{ color: inkText(project.color) }} aria-hidden="true" />
              <span className="w-28 shrink-0 truncate sm:w-36">{name}</span>
              <div className="h-3 min-w-0 flex-1 bg-surface-2" aria-hidden="true">
                <div
                  className="h-full border-r-2"
                  style={{ width: `${(count / most) * 100}%`, background: tint(project.color, 42), borderColor: project.color }}
                />
              </div>
              <span className="figures w-5 shrink-0 text-right font-semibold">{count}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
