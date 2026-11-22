import { useCallback, useEffect, useRef, useState } from "react";
import { api as realApi } from "../api";
import { __ } from "../i18n";

/** What a plan item is about: the id of the project, to-do or habit, or a chore's words. */
export const planRef = (item) =>
  item.kind === "project" ? item.project_id : item.kind === "todo" ? item.todo_id : item.kind === "habit" ? item.habit_id : item.label;

const body = (kind, ref) => ({
  kind,
  ...(kind === "project" ? { project_id: ref } : kind === "todo" ? { todo_id: ref } : kind === "habit" ? { habit_id: ref } : { label: ref }),
});

/**
 * The Workspace's plan: the things to do next, in the order to do them (see backend PlanItem). Kept apart from the rest
 * of the tracker's data, like the habits: if it can't be loaded the app works without it. Changes show at once and a
 * failure puts the server's list back.
 *
 * `items` is the plan in order; `has(kind, ref)` whether something is on it; `toggle(kind, ref)` adds it (at the end)
 * or takes it off; `add`, `remove(id)` and `reorder(ids)` do the parts. `kind` is project | todo | habit | chore and `ref`
 * the project, to-do or habit id, or the chore's words (a task or sub-task is a to-do).
 */
export function usePlan(api = realApi) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await api.listPlan();
      if (alive.current) setItems(next);
    } catch {
      // the plan is an extra: without it everything else still works
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const add = useCallback(
    async (kind, ref) => {
      setError("");
      try {
        const item = await api.addToPlan(body(kind, ref));
        if (alive.current) setItems((prev) => (prev.some((x) => x.id === item.id) ? prev : [...prev, item]));
        return true;
      } catch (e) {
        if (alive.current) setError(e.message || __("Something went wrong"));
        return false;
      }
    },
    [api]
  );

  const remove = useCallback(
    async (id) => {
      setItems((prev) => prev.filter((x) => x.id !== id));
      try {
        await api.removeFromPlan(id);
      } catch {
        load();
      }
    },
    [api, load]
  );

  const reorder = useCallback(
    async (ids) => {
      setItems((prev) => {
        const byId = new Map(prev.map((x) => [x.id, x]));
        const first = ids.map((id) => byId.get(id)).filter(Boolean);
        const named = new Set(first.map((x) => x.id));
        return [...first, ...prev.filter((x) => !named.has(x.id))];
      });
      try {
        await api.orderPlan(ids);
      } catch {
        load();
      }
    },
    [api, load]
  );

  const find = (kind, ref) => items.find((x) => x.kind === kind && planRef(x) === ref);
  const has = (kind, ref) => Boolean(find(kind, ref));
  const toggle = (kind, ref) => {
    const found = find(kind, ref);
    return found ? remove(found.id) : add(kind, ref);
  };

  return { items, error, has, toggle, add, remove, reorder, reload: load };
}
