import { useCallback, useEffect, useRef, useState } from "react";
import { api as realApi } from "../api";

const EMPTY = { habits: [], configured: false, synced_at: null, source_file: "" };

/**
 * The habits from the My Habits backup (copied in by the server, see backend/habits.py). Kept apart from the
 * rest of the tracker's data: a server without Drive set up, or a failed sync, must not take the app down.
 * `sync()` copies the newest backup in and reloads; its answer says what happened ({ ok, message }).
 */
export function useHabits(api = realApi) {
  const [data, setData] = useState(EMPTY);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [syncing, setSyncing] = useState(false);
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
      setData({ ...EMPTY, ...next, habits: (next.habits ?? []).map((h) => ({ ...h, entries: h.entries ?? [] })) });
      setStatus("ready");
    } catch {
      if (alive.current) setStatus("error");
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const sync = useCallback(
    async ({ force = false } = {}) => {
      setSyncing(true);
      try {
        const result = await api.syncHabits({ force });
        await load();
        return {
          ok: true,
          message: result.changed ? `Copied ${result.habits} habits from ${result.file_name}` : "Already up to date with the newest backup",
        };
      } catch (error) {
        return { ok: false, message: error.message || "The sync failed" };
      } finally {
        if (alive.current) setSyncing(false);
      }
    },
    [api, load]
  );

  return { ...data, status, syncing, sync, reload: load };
}
