import { N_ } from "../i18n";
// How the Feed is ordered: by what was done to a project, and which way, or by the person's own order. "Worked" is a
// timer session, or a to-do ticked off (see lastWorkedByProject), and it is the same moment a card shows as "Last
// worked ...". "Edited" is the project's `updated_at`: its details, status, notes or to-dos changed (work or not).
// Both can be followed at once: then a project counts from whichever of the two is later ("Last active ..."). The
// cadence setting applies too: projects can wait out their "done every N days" (every order) and, in the rotation, the
// cadence can also push them back. Pinned cards go on top, and the project whose timer is running stays first of all.

export const FEED_MODES = [
  { id: "newest", label: N_("Newest worked first"), note: N_("The project you worked on most recently comes first.") },
  { id: "rotation", label: N_("Oldest worked first"), note: N_("The project left longest without work comes first.") },
  { id: "edited", label: N_("Recently edited first"), note: N_("The project you changed most recently comes first: its details, status, notes or to-dos.") },
  { id: "edited-oldest", label: N_("Oldest edited first"), note: N_("The project left longest without a change comes first: its details, status, notes or to-dos.") },
  { id: "both", label: N_("Newest worked or edited first"), note: N_("The project you worked on or changed most recently comes first.") },
  { id: "both-oldest", label: N_("Oldest worked or edited first"), note: N_("The project left longest without work or a change comes first.") },
  { id: "manual", label: N_("My order"), note: N_("Your own order. Use Sort to swipe through it; Skip sends a card to the back.") },
];

// The picker shows an order as what it follows (worked, edited, or both) and which way (newest or oldest first), or
// "My order". Each combination is one mode above, keyed here by "worked", "edited" or "both".
const BY_FOLLOW = {
  worked: { newest: "newest", oldest: "rotation" },
  edited: { newest: "edited", oldest: "edited-oldest" },
  both: { newest: "both", oldest: "both-oldest" },
};

/** A mode as the picker's choices: { worked, edited, dir, manual }; `dir` is "newest" or "oldest" (null for "My order"). */
export function splitMode(mode) {
  if (mode === "manual") return { worked: false, edited: false, dir: null, manual: true };
  for (const [follow, dirs] of Object.entries(BY_FOLLOW)) {
    for (const [dir, id] of Object.entries(dirs)) {
      if (id === mode) return { worked: follow !== "edited", edited: follow !== "worked", dir, manual: false };
    }
  }
  return { worked: true, edited: false, dir: "oldest", manual: false };
}

/** The mode for what is followed and the way. Following nothing is not an order: it counts as worked. */
export function joinMode({ worked, edited }, dir) {
  return BY_FOLLOW[worked && edited ? "both" : edited ? "edited" : "worked"][dir];
}

/** When a project was last touched by what the order follows: its last work, its last edit, or the later of both. */
export function touchedAt({ lastWorked, edited }, { worked, edited: byEdited }) {
  const times = [worked && lastWorked, byEdited && edited].filter(Boolean).map((d) => d.getTime());
  return times.length ? new Date(Math.max(...times)) : null;
}

export const DEFAULT_ORDER = { mode: "rotation", manual: [], pinned: [], displace: false, hide: true };

const DAY_MS = 86_400_000;

/** The orders where "Plus days" works: every one but "My order", which is the saved order as it is. */
export const supportsDays = (mode) => mode !== "manual";

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
 * `order` is { mode, manual: [ids], pinned: [ids], displace }; `runningId` is the card whose timer is running,
 * if any. Returns the queue in the order the Feed shows. Every sort is stable, so cards that tie keep their rotation order.
 *
 *  · newest: by last work, latest first; cards never worked on go last.
 *  · edited / both: by `edited` (the project's last change), or by the later of that and its last work; latest first,
 *    or with "-oldest" oldest first.
 *  · With `displace`, each project in those orders is moved back by its cadence (`cadence_days`): oldest first, it
 *    counts from its last touch plus the cadence (like the rotation, below); newest first, from its last touch minus
 *    the cadence, so a project done "every 7 days" sits behind the ones touched up to 7 days before it.
 *  · rotation: the queue as it is, the oldest work first; with `displace` each project is ordered by when it is due
 *    again, its last work plus its cadence (`cadence_days`), so a project done "every 7 days" waits behind the others.
 *  · manual: the saved order; cards not in it yet (new projects) follow it, in rotation order.
 */
export function orderQueue(queue, { mode, manual = [], pinned = [], displace = false }, runningId) {
  let list = [...queue];
  if (mode === "manual") {
    const at = new Map(manual.map((id, i) => [id, i]));
    list.sort((a, b) => (at.get(a.project.id) ?? Infinity) - (at.get(b.project.id) ?? Infinity));
  } else if (mode !== "rotation") {
    const follow = splitMode(mode);
    const sign = follow.dir === "newest" ? -1 : 1;
    // With `displace` the cadence moves a project toward the back: later when oldest first, earlier when newest first
    const at = (entry) => {
      const touched = touchedAt(entry, follow)?.getTime() ?? 0;
      return displace && touched > 0 ? touched + sign * (entry.project.cadence_days || 0) * DAY_MS : touched;
    };
    list.sort((a, b) => sign * (at(a) - at(b)));
  } else if (displace) {
    list.sort((a, b) => dueAt(a) - dueAt(b));
  }
  const pin = new Map(pinned.map((id, i) => [id, i]));
  list.sort(
    (a, b) =>
      Number(b.project.id === runningId) - Number(a.project.id === runningId) ||
      (pin.get(a.project.id) ?? Infinity) - (pin.get(b.project.id) ?? Infinity)
  );
  return list;
}
