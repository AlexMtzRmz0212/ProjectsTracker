// Time math shared by the cards, calendar, heatmap and stats.
// Sessions arrive from the API in UTC; everything here groups them by the
// browser's *local* calendar day.

const pad = (n) => String(n).padStart(2, "0");

/** "yyyy-MM-dd" in local time. Used as the key for every per-day lookup. */
export function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

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
