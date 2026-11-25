import { N_ } from "../i18n";
// How the Feed is ordered. There are three orders: newest worked first, oldest worked first (the rotation) and the
// person's own. "Worked" is a timer session, or a to-do ticked off (see lastWorkedByProject). Three settings apply to
// every order: where the Tasks card goes, whether projects wait out their "done every N days", and, in the rotation,
// whether the cadence also pushes them back. Pinned cards go on top, and the project whose timer is running stays
// first of all.

export const FEED_MODES = [
  { id: "newest", label: N_("Newest worked first"), note: N_("The project you worked on most recently comes first.") },
  { id: "rotation", label: N_("Oldest worked first"), note: N_("The project left longest without work comes first. Skip sends a card to the back.") },
  { id: "manual", label: N_("My order"), note: N_("Your own order. Use Sort to swipe through it; Skip sends a card to the back.") },
];

/** Where the Tasks card sits among the projects: wherever its own work puts it, or on top, or at the bottom. */
export const TASKS_PLACES = [
  { id: "mixed", label: N_("Mixed in") },
  { id: "top", label: N_("On top") },
  { id: "bottom", label: N_("At the bottom") },
];

export const DEFAULT_ORDER = { mode: "rotation", manual: [], pinned: [], displace: false, hide: true, tasks: "mixed" };

const DAY_MS = 86_400_000;

/** When a card is due in the rotation with its cadence counted: the moment it was last worked (or skipped) plus its
 *  "done every N days". A card never worked on is due at once (0), and one with no cadence is due when its turn comes. */
const dueAt = ({ project, rank }) => (rank > 0 ? rank + (project.cadence_days || 0) * DAY_MS : 0);

/** The day (local midnight) a project's wait ends on: the day it was last worked plus its "done every N days". Null when
 *  it has no cadence or was never worked. Calendar days, so a project worked at any time today with a cadence of 5 is
 *  hidden today and for 4 more days, and is back on the fifth. */
export function backOn(project, lastWorked) {
  if (!lastWorked || !(project.cadence_days > 0)) return null;
  return new Date(lastWorked.getFullYear(), lastWorked.getMonth(), lastWorked.getDate() + project.cadence_days);
}

/**
 * With `hide`, cards whose "done every N days" has not passed yet stay out of the Feed, in every order. Returns
 * `{ ready, waiting }`: `ready` is the queue without them, `waiting` the hidden ones as { ...entry, backOn } with the
 * soonest back first. `today` is the local midnight that opens today. Nothing waits when `hide` is off, and the running
 * card, pinned cards, never-worked projects, projects with no cadence and the Tasks card always stay. Skipping does
 * not count as work, so it never hides a card.
 */
export function splitWaiting(queue, { hide, pinned = [] }, runningId, today) {
  if (!hide) return { ready: queue, waiting: [] };
  const ready = [];
  const waiting = [];
  for (const entry of queue) {
    const { project } = entry;
    const back = project.kind === "tasks" || project.id === runningId || pinned.includes(project.id) ? null : backOn(project, entry.lastWorked);
    if (back && back > today) waiting.push({ ...entry, backOn: back });
    else ready.push(entry);
  }
  waiting.sort((a, b) => a.backOn - b.backOn);
  return { ready, waiting };
}

/**
 * `queue` is [{ project, lastWorked, rank }] in rotation order (oldest worked first, a skip counting as work);
 * `order` is { mode, manual: [ids], pinned: [ids], displace, tasks }; `runningId` is the card whose timer is running,
 * if any. Returns the queue in the order the Feed shows. Every sort is stable, so cards that tie keep their rotation order.
 *
 *  · newest: by last work, latest first; a skip does not move a card, and cards never worked on go last.
 *  · rotation: the queue as it is; with `displace` each project is ordered by when it is due again, its last work
 *    plus its cadence (`cadence_days`), so a project done "every 7 days" waits behind the others for a week.
 *  · manual: the saved order; cards not in it yet (new projects) follow it, in rotation order.
 * `tasks` then puts the Tasks card on top or at the bottom ("mixed" leaves it where its own work put it).
 */
export function orderQueue(queue, { mode, manual = [], pinned = [], displace = false, tasks = "mixed" }, runningId) {
  let list = [...queue];
  if (mode === "manual") {
    const at = new Map(manual.map((id, i) => [id, i]));
    list.sort((a, b) => (at.get(a.project.id) ?? Infinity) - (at.get(b.project.id) ?? Infinity));
  } else if (mode === "newest") {
    list.sort((a, b) => (b.lastWorked?.getTime() ?? 0) - (a.lastWorked?.getTime() ?? 0));
  } else if (displace) {
    list.sort((a, b) => dueAt(a) - dueAt(b));
  }
  const isTasks = (entry) => entry.project.kind === "tasks";
  if (tasks === "top") list.sort((a, b) => Number(isTasks(b)) - Number(isTasks(a)));
  else if (tasks === "bottom") list.sort((a, b) => Number(isTasks(a)) - Number(isTasks(b)));
  const pin = new Map(pinned.map((id, i) => [id, i]));
  list.sort(
    (a, b) =>
      Number(b.project.id === runningId) - Number(a.project.id === runningId) ||
      (pin.get(a.project.id) ?? Infinity) - (pin.get(b.project.id) ?? Infinity)
  );
  return list;
}
