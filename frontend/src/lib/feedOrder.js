// How the Feed is ordered. The queue from `feedQueue` (least recently worked first) is the base; a mode
// re-sorts it, pinned cards go on top, and the project whose timer is running stays first of all.

export const FEED_MODES = [
  { id: "rotation", label: "Rotation", note: "Least recently worked first. Skip sends a card to the back." },
  { id: "manual", label: "My order", note: "Your own order. Use Sort to swipe through it; Skip sends a card to the back." },
  { id: "edited", label: "Recently edited", note: "Whatever was touched last comes first." },
  { id: "tasks", label: "Tasks first", note: "The Tasks card on top, then the projects by rotation." },
  { id: "projects", label: "Projects first", note: "The projects by rotation, then the Tasks card." },
];

export const DEFAULT_ORDER = { mode: "rotation", manual: [], pinned: [] };

const stamp = (value) => (value ? Date.parse(value) || 0 : 0);

/** How recently a card was edited or worked: a project's last edit, or its last work, whichever is later. */
const touched = ({ project, lastWorked }) => Math.max(stamp(project.updated_at), lastWorked ? lastWorked.getTime() : 0);

/**
 * `queue` is [{ project, lastWorked }] in rotation order; `order` is { mode, manual: [ids], pinned: [ids] };
 * `runningId` is the card whose timer is running, if any. Returns the queue in the order the Feed shows.
 * Every sort is stable, so cards that tie keep their rotation order.
 */
export function orderQueue(queue, { mode, manual, pinned }, runningId) {
  let list = [...queue];
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
