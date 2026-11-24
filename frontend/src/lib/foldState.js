// Which to-dos have their sub-to-dos folded away, remembered per list (a project's, or the Tasks tab's) so a list comes
// back the way it was left. Kept under a key that carries the user id, like the other things this browser remembers.
//
// Two ways to remember it: a list that starts open remembers what was folded (`loadFolded`), and a list that starts
// folded (a project's, and the Workspace's) remembers what was opened (`loadExpanded`), so a new to-do with
// sub-to-dos is folded too.

import { scopedKey } from "./storage";

const key = (scope) => scopedKey(`pt-todo-folded-${scope}`);
const expandedKey = (scope) => scopedKey(`pt-todo-expanded-${scope}`);

function load(storageKey) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    return new Set(Array.isArray(saved) ? saved.map(String) : []);
  } catch {
    return new Set();
  }
}

function save(storageKey, ids, existing) {
  try {
    const alive = new Set(existing.map(String));
    const keep = [...ids].filter((id) => alive.size === 0 || alive.has(String(id)));
    if (keep.length) localStorage.setItem(storageKey, JSON.stringify(keep));
    else localStorage.removeItem(storageKey);
  } catch {
    // a preference is a nicety: not saving it changes nothing
  }
}

/** The ids folded in a list ("project id" or "tasks"); none if nothing was saved, or storage is out of reach. */
export const loadFolded = (scope) => load(key(scope));

/** Save the folded ids of a list. `existing` (the ids of the to-dos it has now) drops the ones that are gone, unless
 *  it is empty: a list that hasn't loaded yet must not lose what it remembers. */
export const saveFolded = (scope, folded, existing = []) => save(key(scope), folded, existing);

/** The ids opened in a list that starts folded; none (everything folded) if nothing was saved. */
export const loadExpanded = (scope) => load(expandedKey(scope));

/** Save the opened ids of a list that starts folded, dropping the ones that are gone (see saveFolded). */
export const saveExpanded = (scope, expanded, existing = []) => save(expandedKey(scope), expanded, existing);
