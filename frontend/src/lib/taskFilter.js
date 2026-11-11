// Filters for the Tasks tab: a text search plus a few toggles, kept between visits.

export const FILTER_CHIPS = [
  { id: "working", label: "Working on", hint: "Marked as being worked on" },
  { id: "active", label: "Running", hint: "Its timer is running, or it is left open" },
  { id: "timed", label: "Has time", hint: "Time is logged on it" },
  { id: "subs", label: "Has sub-tasks", hint: "Has sub-tasks still to do" },
  { id: "recent", label: "Added this week", hint: "Added in the last 7 days" },
];

const KEY = "pt-tasks-filter";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const EMPTY_FILTER = { q: "", chips: [] };

export function loadFilter() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    const ids = new Set(FILTER_CHIPS.map((c) => c.id));
    return {
      q: typeof saved?.q === "string" ? saved.q : "",
      chips: Array.isArray(saved?.chips) ? saved.chips.filter((id) => ids.has(id)) : [],
    };
  } catch {
    return EMPTY_FILTER;
  }
}

export function saveFilter(filter) {
  try {
    localStorage.setItem(KEY, JSON.stringify(filter));
  } catch {
    // private window or storage blocked: the filter just isn't remembered
  }
}

export const isFiltering = (filter) => filter.q.trim() !== "" || filter.chips.length > 0;

/**
 * Whether a task passes the filter: the text search (on it or any of its sub-tasks) and every chosen toggle.
 * `ctx` is { subs: its sub-tasks, seconds: time on it, active: timer running or left open, now: ms }.
 */
export function taskMatches(task, filter, { subs, seconds, active, now }) {
  const q = filter.q.trim().toLowerCase();
  if (q && ![task, ...subs].some((t) => t.text.toLowerCase().includes(q))) return false;
  return filter.chips.every((chip) => {
    switch (chip) {
      case "working":
        return Boolean(task.working_since);
      case "active":
        return active;
      case "timed":
        return seconds >= 60;
      case "subs":
        return subs.some((s) => !s.done);
      case "recent":
        return task.created_at ? now - new Date(task.created_at).getTime() <= WEEK_MS : false;
      default:
        return true;
    }
  });
}
