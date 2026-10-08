import { format } from "date-fns";
import { Check, Hourglass } from "lucide-react";
import { iconFor, inkText, tint } from "../lib/palette";

/** "2d 3h", "3h 20m", "12m": how long something has been open, in its two biggest units. */
export function fmtOpen(seconds) {
  const m = Math.floor(seconds / 60);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return `${Math.max(m, 0)}m`;
}

/**
 * The things left open, along under the tabs on every view, so none is forgotten: each with what it is on,
 * how long it has been open, and Close (which makes it a session ending now). Clicking one opens it, to
 * change it or close it at another time. Nothing shows while nothing is open.
 */
export default function OpenItemsBar({ items, subjectsById, now, onOpen, onClose, className = "" }) {
  const shown = items.filter((x) => subjectsById.has(x.project_id));
  if (shown.length === 0) return null;
  return (
    <div className={`flex items-center gap-2 overflow-x-auto py-1.5 ${className}`} role="region" aria-label="Open items">
      <span className="inline-flex shrink-0 items-center gap-1 font-serif text-xs italic text-muted">
        <Hourglass size={12} aria-hidden="true" /> Open
      </span>
      {shown.map((item) => {
        const subject = subjectsById.get(item.project_id);
        const Icon = iconFor(subject.icon);
        const label = `${subject.name}${item.note ? `, ${item.note}` : ""}`;
        return (
          <span
            key={item.id}
            className="inline-flex h-8 max-w-[22rem] shrink-0 items-stretch border"
            style={{ borderColor: tint(subject.color, 50), background: tint(subject.color, 10) }}
          >
            <button
              onClick={() => onOpen(item)}
              className="flex min-w-0 items-center gap-2 px-2.5 text-[13px] transition-colors hover:bg-surface-2"
              title={`${label}. Open since ${format(item.start, "EEE d MMM, HH:mm")}. Click to edit or close at another time`}
            >
              <Icon size={13} style={{ color: inkText(subject.color) }} className="shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate font-medium">{subject.name}</span>
              {item.note && <span className="min-w-0 truncate font-serif text-xs italic text-muted max-sm:hidden">{item.note}</span>}
              <span className="figures shrink-0 font-semibold">{fmtOpen((now - item.start) / 1000)}</span>
            </button>
            <button
              onClick={() => onClose(item)}
              className="flex items-center gap-1 border-l px-2 text-xs font-semibold transition-colors hover:bg-surface-2"
              style={{ borderColor: tint(subject.color, 50) }}
              aria-label={`Close ${label} now`}
              title="Close it now: it becomes a session"
            >
              <Check size={13} aria-hidden="true" /> <span className="max-sm:sr-only">Close</span>
            </button>
          </span>
        );
      })}
    </div>
  );
}
