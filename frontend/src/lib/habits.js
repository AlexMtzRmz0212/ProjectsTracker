// Reading the habits that come from the My Habits backup (see backend/habits.py). A habit has `entries`, one per day:
// { entry_date: "yyyy-MM-dd", status: yes | no | skip | unknown | value, value }. A numerical habit's value is the
// number, a time habit's is the minutes since midnight.

const HISTORY = 120; // days the server keeps, so no streak is counted further back

export const dayKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The key of the day `ago` days before `from` (a Date). */
export const keyDaysAgo = (from, ago) => dayKey(new Date(from.getFullYear(), from.getMonth(), from.getDate() - ago));

export const isActive = (habit) => !habit.archived && !habit.removed_at;

/** A time habit's minutes since midnight as "23:15". */
export const fmtMinutes = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(Math.round(minutes % 60)).padStart(2, "0")}`;

/** What an entry says, in words: "yes", "6 glasses", "23:15". */
export function fmtEntry(habit, entry) {
  if (!entry) return "nothing logged";
  if (entry.status !== "value") return entry.status === "unknown" ? "nothing logged" : entry.status;
  if (habit.value_type === "time") return fmtMinutes(entry.value);
  const n = Number.isInteger(entry.value) ? entry.value : Math.round(entry.value * 100) / 100;
  return habit.unit ? `${n} ${habit.unit}` : String(n);
}

/** A habit's target, in words ("at least 8 glasses"); null if it has none. */
export function fmtTarget(habit) {
  if (habit.target_value == null || !habit.target_type) return null;
  const goal = habit.value_type === "time" ? fmtMinutes(habit.target_value) : fmtEntry(habit, { status: "value", value: habit.target_value });
  return `${habit.target_type === "at_most" ? "at most" : "at least"} ${goal}`;
}

/** How one day went: done, missed, skip (a day off that doesn't break a streak) or none (nothing logged). */
export function dayState(habit, entry) {
  if (!entry) return "none";
  if (entry.status === "yes") return "done";
  if (entry.status === "no") return "missed";
  if (entry.status === "skip") return "skip";
  if (entry.status !== "value" || entry.value == null) return "none";
  if (habit.target_value == null || !habit.target_type) return "done";
  const met = habit.target_type === "at_most" ? entry.value <= habit.target_value : entry.value >= habit.target_value;
  return met ? "done" : "missed";
}

/** The entries of a habit by day. */
export const entriesByDay = (habit) => new Map(habit.entries.map((e) => [e.entry_date, e]));

/** Days in a row that were done, up to today. A skipped day neither counts nor breaks it, and a today with nothing
 *  logged yet doesn't break it either (the day isn't over). */
export function streakOf(habit, today = new Date()) {
  const byDay = entriesByDay(habit);
  let count = 0;
  for (let ago = 0; ago < HISTORY; ago++) {
    const state = dayState(habit, byDay.get(keyDaysAgo(today, ago)));
    if (state === "done") count++;
    else if (state === "skip" || (ago === 0 && state === "none")) continue;
    else break;
  }
  return count;
}

/** The last `n` days, oldest first: [{ key, date, entry, state }]. */
export function lastDays(habit, n, today = new Date()) {
  const byDay = entriesByDay(habit);
  return Array.from({ length: n }, (_, i) => {
    const ago = n - 1 - i;
    const key = keyDaysAgo(today, ago);
    const entry = byDay.get(key);
    return { key, ago, entry, state: dayState(habit, entry) };
  });
}

/** Whether today still needs something logged (an active habit with nothing for today). */
export const dueToday = (habit, today = new Date()) => isActive(habit) && !entriesByDay(habit).has(dayKey(today));
