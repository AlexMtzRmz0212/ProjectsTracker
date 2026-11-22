import { useCallback, useEffect, useRef, useState } from "react";
import { api as realApi } from "../api";
import { __ } from "../i18n";

const EMPTY = { habits: [], configured: false, synced_at: null, source_file: "" };
const withEntries = (h) => ({ ...h, entries: h.entries ?? [] });

/**
 * The habits: the ones picked from the My Habits backup (copied in by the server, see backend/habits.py) and the ones
 * made here. Kept apart from the rest of the tracker's data: a server without Drive set up, or a failed sync, must not
 * take the app down.
 *
 * `sync()` brings the habits already added from Drive up to date, and `importFromDrive(uuids)` adds chosen ones (see
 * `listDrive()` for the choices); both answer { ok, message }. The habits made here are `create`d, `update`d, `remove`d
 * and logged a day at a time (`setDay`); each answers true, or false after saying why in `error`.
 */
export function useHabits(api = realApi) {
  const [data, setData] = useState(EMPTY);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [syncing, setSyncing] = useState(false);
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
      const next = await api.listHabits();
      if (!alive.current) return;
      setData({ ...EMPTY, ...next, habits: (next.habits ?? []).map(withEntries) });
      setStatus("ready");
    } catch {
      if (alive.current) setStatus("error");
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const copy = useCallback(
    async (run, done) => {
      setSyncing(true);
      try {
        const result = await run();
        await load();
        return { ok: true, message: done(result) };
      } catch (e) {
        return { ok: false, message: e.message || __("The sync failed") };
      } finally {
        if (alive.current) setSyncing(false);
      }
    },
    [load]
  );

  const sync = useCallback(
    ({ force = false } = {}) =>
      copy(
        () => api.syncHabits({ force }),
        (result) =>
          result.changed
            ? __("Updated {habits} habits from {file_name}", { habits: result.habits, file_name: result.file_name })
            : __("Already up to date with the newest backup")
      ),
    [api, copy]
  );

  const importFromDrive = useCallback(
    (uuids) => copy(() => api.importHabits(uuids), (result) => __("Added from {file_name}; {habits} habits are kept up to date", { habits: result.habits, file_name: result.file_name })),
    [api, copy]
  );

  /** What is in the newest Drive backup (see the API), or throws with the reason. */
  const listDrive = useCallback(() => api.listDriveHabits(), [api]);

  // Changes to the habits made here: shown at once from the server's answer. A failure leaves everything as it was
  const change = useCallback(
    async (run) => {
      setError("");
      try {
        await run();
        return true;
      } catch (e) {
        if (alive.current) setError(e.message || __("Something went wrong"));
        return false;
      }
    },
    []
  );
  const replace = (habit) => setData((d) => ({ ...d, habits: d.habits.map((h) => (h.id === habit.id ? withEntries(habit) : h)) }));

  const create = useCallback(
    (body) => change(async () => {
      const made = await api.createHabit(body);
      setData((d) => ({ ...d, habits: [...d.habits, withEntries(made)] }));
    }),
    [api, change]
  );
  const update = useCallback((id, body) => change(async () => replace(await api.updateHabit(id, body))), [api, change]);
  const remove = useCallback(
    (id) => change(async () => {
      await api.deleteHabit(id);
      setData((d) => ({ ...d, habits: d.habits.filter((h) => h.id !== id) }));
    }),
    [api, change]
  );
  const setDay = useCallback((id, day, body) => change(async () => replace(await api.setHabitDay(id, day, body))), [api, change]);

  return { ...data, status, syncing, error, sync, importFromDrive, listDrive, create, update, remove, setDay, reload: load };
}
