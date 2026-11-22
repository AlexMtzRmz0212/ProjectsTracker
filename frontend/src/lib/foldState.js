// Which to-dos have their sub-to-dos folded away, remembered per list (a project's, or the Tasks tab's) so a list comes
// back the way it was left. Kept under a key that carries the user id, like the other things this browser remembers.

import { scopedKey } from "./storage";

const key = (scope) => scopedKey(`pt-todo-folded-${scope}`);

/** The ids folded in a list ("project id" or "tasks"); none if nothing was saved, or storage is out of reach. */
export function loadFolded(scope) {
  try {
    const saved = JSON.parse(localStorage.getItem(key(scope)));
    return new Set(Array.isArray(saved) ? saved.map(String) : []);
  } catch {
    return new Set();
  }
}

/** Save the folded ids of a list. `existing` (the ids of the to-dos it has now) drops the ones that are gone, unless
 *  it is empty: a list that hasn't loaded yet must not lose what it remembers. */
export function saveFolded(scope, folded, existing = []) {
  try {
    const alive = new Set(existing.map(String));
    const keep = [...folded].filter((id) => alive.size === 0 || alive.has(String(id)));
    if (keep.length) localStorage.setItem(key(scope), JSON.stringify(keep));
    else localStorage.removeItem(key(scope));
  } catch {
    // a preference is a nicety: not saving it changes nothing
  }
}
