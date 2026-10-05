// Time math shared by the cards, calendar, heatmap and stats.
// Sessions arrive from the API in UTC; everything here groups them by the
// browser's *local* calendar day.

const pad = (n) => String(n).padStart(2, "0");

/** "yyyy-MM-dd" in local time. Used as the key for every per-day lookup. */
export function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A timer stopped before this many seconds was a mis-click: no session is kept. Mirrors the server. */
export const MIN_TIMER_SECONDS = 120;

/** Whether a running session, ended at `now`, is too short to keep. */
export const tooShort = (session, now) => (now - session.start) / 1000 < MIN_TIMER_SECONDS;

export function sessionSeconds(session, now) {
  const end = session.end ?? now;
  return Math.max(0, (end - session.start) / 1000);
}

/** Split [start, end) at local midnights → [[dayKey, seconds], ...]. */
export function splitByDay(start, end) {
  const parts = [];
  let cursor = start;
  while (cursor < end) {
    const nextMidnight = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    const segEnd = nextMidnight < end ? nextMidnight : end;
    parts.push([dayKey(cursor), (segEnd - cursor) / 1000]);
    cursor = segEnd;
  }
  return parts;
}

function addToDay(map, key, projectId, seconds) {
  const day = map.get(key) ?? { total: 0, byProject: new Map() };
  day.total += seconds;
  day.byProject.set(projectId, (day.byProject.get(projectId) ?? 0) + seconds);
  map.set(key, day);
}

/** Map<dayKey, {total, byProject: Map<projectId, seconds>}> for closed sessions. */
export function aggregateByDay(sessions) {
  const map = new Map();
  for (const s of sessions) {
    if (!s.end) continue;
    for (const [key, secs] of splitByDay(s.start, s.end)) addToDay(map, key, s.project_id, secs);
  }
  return map;
}

/** Layer the running session on top of the closed-session map without mutating it. */
export function withLive(base, running, now) {
  if (!running) return base;
  const map = new Map(base);
  for (const [key, secs] of splitByDay(running.start, now)) {
    const prev = map.get(key);
    map.set(key, {
      total: (prev?.total ?? 0) + secs,
      byProject: new Map(prev?.byProject ?? []),
    });
    const day = map.get(key);
    day.byProject.set(running.project_id, (day.byProject.get(running.project_id) ?? 0) + secs);
  }
  return map;
}

export function daySeconds(byDay, date, projectId) {
  const day = byDay.get(dayKey(date));
  if (!day) return 0;
  return projectId ? day.byProject.get(projectId) ?? 0 : day.total;
}

// ── Pomodoros ────────────────────────────────────────────────────────────────
// A pomodoro is a start, an end and whether its countdown ran out (`completed`; a focus that was
// stopped or cut short is kept, but isn't counted). What it covered is whatever sessions ran inside it.

/** Pomodoros that ended on the local calendar day of `date`, cut-short ones included. */
export const pomodorosOnDay = (pomodoros, date) => pomodoros.filter((p) => dayKey(p.end) === dayKey(date));

/** The pomodoros whose countdown ran out: the ones that are counted. */
export const completedPomodoros = (pomodoros) => pomodoros.filter((p) => p.completed);

/** Map<projectId, seconds>: the time each project was worked on inside a pomodoro, its sessions
 *  clipped to the pomodoro's span. A running session counts up to `now`. */
export function pomodoroProjects(pomodoro, sessions, now) {
  const map = new Map();
  for (const s of sessions) {
    const from = Math.max(s.start, pomodoro.start);
    const to = Math.min(s.end ?? now, pomodoro.end);
    if (to > from) map.set(s.project_id, (map.get(s.project_id) ?? 0) + (to - from) / 1000);
  }
  return map;
}

/** How many (completed) pomodoros a project was worked on during. */
export function projectPomodoroCount(projectId, sessions, pomodoros, now) {
  const own = sessions.filter((s) => s.project_id === projectId);
  return completedPomodoros(pomodoros).filter((p) => own.some((s) => s.start < p.end && (s.end ?? now) > p.start)).length;
}

/** Map<projectId, Date>: when each project was last worked on, the later of the end of its latest
 *  session (`now` for one whose timer is running) and the moment one of its to-dos was ticked off
 *  (work done without a timer). Projects with neither in `sessions`/`todos` are absent. */
function lastWorkedByProject(sessions, now, todos) {
  const last = new Map();
  const note = (projectId, at) => {
    if (!last.has(projectId) || at > last.get(projectId)) last.set(projectId, at);
  };
  for (const s of sessions) note(s.project_id, s.end ?? now);
  for (const todo of todos) if (todo.done && todo.completed_at) note(todo.project_id, new Date(todo.completed_at));
  return last;
}

/** The open project that most needs attention: { project, since, never } or null.
 *  Projects never worked on rank above any that have logs (oldest-created first); otherwise the
 *  one idle longest wins. "Last worked" is the end of its latest session (now, if its timer is
 *  running) or when it last had a to-do ticked, whichever is later; a project with neither in the
 *  loaded window counts from when it was created (and is "never" worked only if it has no logged
 *  time at all, since older sessions may sit outside the window). */
export function mostNeglected(projects, sessions, now, todos = []) {
  const last = lastWorkedByProject(sessions, now, todos);
  let found = null;
  for (const project of projects) {
    const worked = last.get(project.id);
    const since = worked ?? new Date(project.created_at);
    const never = !worked && !(project.total_seconds > 0);
    const better = !found || (never !== found.never ? never : since < found.since);
    if (better) found = { project, since, never };
  }
  return found;
}

/** The Feed's queue: [{ project, lastWorked }] with the project to work on next first, where
 *  `lastWorked` is a Date, or null if it never has been. Projects are ranked by the later of when
 *  they were last worked on and when they were last skipped (a missing moment counts as 0), so
 *  the least recently touched comes first, never-touched ones lead (oldest-created first), and a
 *  skip sends a project behind everything else until the others have had their turn. The running
 *  project is pinned to the top. As in mostNeglected, a project with logged time but no session in
 *  the loaded window counts from when it was created. */
export function feedQueue(projects, sessions, now, runningId, todos = []) {
  const last = lastWorkedByProject(sessions, now, todos);
  const items = projects.map((project) => {
    const worked = last.get(project.id) ?? (project.total_seconds > 0 ? new Date(project.created_at) : null);
    const skipped = project.skipped_at ? new Date(project.skipped_at) : null;
    return { project, lastWorked: worked, rank: Math.max(worked?.getTime() ?? 0, skipped?.getTime() ?? 0) };
  });
  items.sort(
    (a, b) =>
      (b.project.id === runningId) - (a.project.id === runningId) ||
      a.rank - b.rank ||
      new Date(a.project.created_at) - new Date(b.project.created_at)
  );
  return items.map(({ project, lastWorked }) => ({ project, lastWorked }));
}

/** Consecutive days with at least a minute logged, ending today (or yesterday
 *  if nothing has been logged yet today, so the streak isn't "lost" at 00:01). */
export function streak(byDay, today) {
  const active = (d) => (byDay.get(dayKey(d))?.total ?? 0) >= 60;
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!active(d)) d.setDate(d.getDate() - 1);
  let count = 0;
  while (active(d)) {
    count++;
    d.setDate(d.getDate() - 1);
  }
  return count;
}

export const HEATMAP_WEEKS = 53;

/** Monday that opens the heatmap: 52 full weeks before the current week. */
export function heatmapStart(today) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const sinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - sinceMonday - (HEATMAP_WEEKS - 1) * 7);
  return d;
}

// ── Formatting ───────────────────────────────────────────────────────────────

/** 01:23:45 */
export function fmtClock(seconds) {
  const s = Math.floor(seconds);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** 25:00 · 04:09 (minutes can run past 59: a 90-minute focus reads 90:00) */
export function fmtCountdown(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/** 2h 15m · 45m · <1m · 0m */
export function fmtHM(seconds) {
  if (seconds < 60) return seconds > 0 ? "<1m" : "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Compact label for tight spots: 45m · 2.5h · 12h */
export function fmtShort(seconds) {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m`;
  const h = seconds / 3600;
  return `${h >= 10 ? Math.round(h) : Number(h.toFixed(1))}h`;
}

/** 09:05 in the user's locale */
export function fmtTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Value for <input type="date"> / <input type="time"> in local time */
export function toDateInput(date) {
  return dayKey(date);
}
export function toTimeInput(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function fromInputs(dateStr, timeStr) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi);
}

// ── Typed time entry ─────────────────────────────────────────────────────────

/** "9", "930", "9:30", "21.15", "9am", "9:30 pm" → minutes since midnight, or null. */
export function parseClock(text) {
  const m = /^(\d{1,2})(?:[:.]?(\d{2}))?\s*(a|p)?m?$/i.exec(String(text).trim());
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = m[2] ? Number(m[2]) : 0;
  if (minutes > 59) return null;
  if (m[3]) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (m[3].toLowerCase() === "p" ? 12 : 0);
  }
  return hours < 24 ? hours * 60 + minutes : null;
}

/** "1h 30m", "1h30", "1.5h", "90", "45m", "1:30" → minutes, or null. A bare number is minutes. */
export function parseDuration(text) {
  const t = String(text).trim().toLowerCase().replace(",", ".");
  let minutes = null;
  let m;
  if ((m = /^(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?(?:\s*(\d+)\s*(?:m(?:in\w*)?)?)?$/.exec(t))) {
    minutes = Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0);
  } else if ((m = /^(\d+)\s*m(?:in\w*)?$/.exec(t))) {
    minutes = Number(m[1]);
  } else if ((m = /^(\d+):([0-5]\d)$/.exec(t))) {
    minutes = Number(m[1]) * 60 + Number(m[2]);
  } else if (/^\d+$/.test(t)) {
    minutes = Number(t);
  }
  minutes = minutes === null ? null : Math.round(minutes);
  return minutes && minutes > 0 && minutes <= 24 * 60 ? minutes : null;
}

/** 90 → "1h 30m", for showing a duration in a text field. */
export function fmtDurationInput(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}
