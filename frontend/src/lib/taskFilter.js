// Filters for the Tasks tab: a text search plus a few toggles, kept between visits.
import { scopedKey } from "./storage";
import { N_ } from "../i18n";

export const FILTER_CHIPS = [
  { id: "working", label: N_("Working on"), hint: N_("Marked as being worked on") },
  { id: "active", label: N_("Running"), hint: N_("Its timer is running, or it is left open") },
  { id: "timed", label: N_("Has time"), hint: N_("Time is logged on it") },
  { id: "subs", label: N_("Has sub-tasks"), hint: N_("Has sub-tasks still to do") },
  { id: "recent", label: N_("Added this week"), hint: N_("Added in the last 7 days") },
];

const KEY = "pt-tasks-filter";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const EMPTY_FILTER = { q: "", chips: [] };

export function loadFilter() {
  try {
    const saved = JSON.parse(localStorage.getItem(scopedKey(KEY)));
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
    localStorage.setItem(scopedKey(KEY), JSON.stringify(filter));
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
