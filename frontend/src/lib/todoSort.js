// How a to-do list is ordered. Manual is the order the to-dos were dragged into (the server's `sort_order`);
// the others sort what is shown, by when a to-do was added or by its text, and leave the stored order alone.

export const SORTS = [
  { id: "manual", label: "Manual" },
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "az", label: "A–Z" },
];

const IDS = new Set(SORTS.map((s) => s.id));
const key = (scope) => `pt-todo-sort-${scope}`;

/** The saved sort for a list ("project" or "tasks"); Manual if none, or if storage is out of reach. */
export function loadSort(scope) {
  try {
    const saved = localStorage.getItem(key(scope));
    return IDS.has(saved) ? saved : "manual";
  } catch {
    return "manual";
  }
}

export function saveSort(scope, mode) {
  try {
    localStorage.setItem(key(scope), mode);
  } catch {
    // a preference is a nicety: not saving it changes nothing
  }
}

const added = (t) => (t.created_at ? new Date(t.created_at).getTime() || 0 : 0);

/** `list` in the order `mode` asks for; a new array, and the same list for Manual. Ties keep their stored order. */
export function sortTodos(list, mode) {
  if (mode === "newest") return [...list].sort((a, b) => added(b) - added(a));
  if (mode === "oldest") return [...list].sort((a, b) => added(a) - added(b));
  if (mode === "az") return [...list].sort((a, b) => a.text.localeCompare(b.text, undefined, { sensitivity: "base", numeric: true }));
  return list;
}
