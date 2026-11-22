// The order of the main tabs (Feed, Workspace, Projects...), as the person arranged them. Kept in this browser under a
// key that carries the user id, like the Feed's order and the other things it remembers. Ids that are saved but are no
// longer tabs are ignored, and tabs that were added since are put at the end in their usual order.

import { scopedKey } from "./storage";

const KEY = "pt-tab-order";

/** The main tabs, in their usual order. */
export const TAB_IDS = ["feed", "workspace", "projects", "tasks", "habits", "calendar", "stats"];

/** The saved order: a list of tab ids, [] when nothing was saved or storage is out of reach. */
export function loadTabOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(scopedKey(KEY)));
    return Array.isArray(saved) ? saved.map(String) : [];
  } catch {
    return [];
  }
}

/** Save the order; an empty list forgets it, back to the usual one. */
export function saveTabOrder(ids) {
  try {
    if (ids.length) localStorage.setItem(scopedKey(KEY), JSON.stringify(ids));
    else localStorage.removeItem(scopedKey(KEY));
  } catch {
    // a preference is a nicety: not saving it changes nothing
  }
}

/** `tabs` ([{ id, ... }], in their usual order) arranged by the saved `order`. */
export function orderTabs(tabs, order) {
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const first = [];
  for (const id of order) {
    if (byId.has(id)) {
      first.push(byId.get(id));
      byId.delete(id);
    }
  }
  return [...first, ...byId.values()];
}
