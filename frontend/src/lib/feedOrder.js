import { N_ } from "../i18n";
// How the Feed is ordered. The queue from `feedQueue` (least recently worked first) is the base; a mode
// re-sorts it, pinned cards go on top, and the project whose timer is running stays first of all.

export const FEED_MODES = [
  { id: "rotation", label: N_("Rotation"), note: N_("Least recently worked first. Skip sends a card to the back.") },
  { id: "manual", label: N_("My order"), note: N_("Your own order. Use Sort to swipe through it; Skip sends a card to the back.") },
  { id: "edited", label: N_("Recently edited"), note: N_("Whatever was touched last comes first.") },
  { id: "tasks", label: N_("Tasks first"), note: N_("The Tasks card on top, then the projects by rotation.") },
  { id: "projects", label: N_("Projects first"), note: N_("The projects by rotation, then the Tasks card.") },
];

export const DEFAULT_ORDER = { mode: "rotation", manual: [], pinned: [], displace: false, hide: true };

const DAY_MS = 86_400_000;
const ROTATION_MODES = ["rotation", "tasks", "projects"];
const stamp = (value) => (value ? Date.parse(value) || 0 : 0);

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
 * With `hide`, cards whose "done every N days" has not passed yet stay out of the Feed. Returns `{ ready, waiting }`:
 * `ready` is the queue without them, `waiting` the hidden ones as { ...entry, backOn } with the soonest back first.
 * `today` is the local midnight that opens today. Nothing waits when `hide` is off or the mode is not a rotation one
 * (My order and Recently edited ignore it), and the running card, pinned cards, never-worked projects, projects with no
 * cadence and the Tasks card always stay. Skipping does not count as work, so it never hides a card.
 */
export function splitWaiting(queue, { mode, hide, pinned = [] }, runningId, today) {
  if (!hide || !ROTATION_MODES.includes(mode)) return { ready: queue, waiting: [] };
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

/** How recently a card was edited or worked: a project's last edit, or its last work, whichever is later. */
const touched = ({ project, lastWorked }) => Math.max(stamp(project.updated_at), lastWorked ? lastWorked.getTime() : 0);

/**
 * `queue` is [{ project, lastWorked, rank }] in rotation order; `order` is { mode, manual: [ids], pinned: [ids],
 * displace }; `runningId` is the card whose timer is running, if any. Returns the queue in the order the Feed shows.
 * Every sort is stable, so cards that tie keep their rotation order.
 *
 * With `displace` the rotation is "rotation + days": each project is ordered by when it is due again, its last work
 * plus its cadence (`cadence_days`), so a project done "every 7 days" waits behind the others for a week. It applies
 * wherever the rotation is the base (Rotation, Tasks first, Projects first); My order and Recently edited ignore it.
 */
export function orderQueue(queue, { mode, manual, pinned, displace = false }, runningId) {
  let list = [...queue];
  if (displace && ROTATION_MODES.includes(mode)) list.sort((a, b) => dueAt(a) - dueAt(b));
  const isTasks = (entry) => entry.project.kind === "tasks";
  if (mode === "manual") {
    // Cards not in the saved order yet (new projects) follow it, in rotation order
    const at = new Map(manual.map((id, i) => [id, i]));
    list.sort((a, b) => (at.get(a.project.id) ?? Infinity) - (at.get(b.project.id) ?? Infinity));
  } else if (mode === "edited") {
    list.sort((a, b) => touched(b) - touched(a));
  } else if (mode === "tasks") {
    list.sort((a, b) => Number(isTasks(b)) - Number(isTasks(a)));
  } else if (mode === "projects") {
    list.sort((a, b) => Number(isTasks(a)) - Number(isTasks(b)));
  }
  const pin = new Map(pinned.map((id, i) => [id, i]));
  list.sort(
    (a, b) =>
      Number(b.project.id === runningId) - Number(a.project.id === runningId) ||
      (pin.get(a.project.id) ?? Infinity) - (pin.get(b.project.id) ?? Infinity)
  );
  return list;
}
