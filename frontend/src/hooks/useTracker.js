import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { heatmapStart } from "../lib/time";

function mergeSessions(prev, incoming) {
  const byId = new Map(prev.map((s) => [s.id, s]));
  for (const s of incoming) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => a.start - b.start);
}

/**
 * All app data and every mutation. Sessions are held as Date-parsed objects;
 * the running timer is simply the one session whose `end` is null.
 * Mutations return true on success; failures surface as a `notice` toast.
 */
export function useTracker() {
  const [projects, setProjects] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [notice, setNotice] = useState(null);
  const loadedFrom = useRef(null);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  const load = useCallback(async () => {
    setStatus((s) => (s === "ready" ? s : "loading"));
    try {
      const from = heatmapStart(new Date());
      const [p, s] = await Promise.all([api.listProjects(), api.listSessions({ start: from })]);
      loadedFrom.current = from;
      setProjects(p);
      setSessions(s);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await api.listProjects());
    } catch {
      // totals just stay slightly stale until the next refresh
    }
  }, []);

  /** Wrap a mutation: on failure show a toast and resync from the server. */
  const attempt = useCallback(
    async (fn) => {
      try {
        await fn();
        return true;
      } catch (err) {
        setNotice({ id: Date.now(), text: err.message || "Something went wrong" });
        load();
        return false;
      }
    },
    [load]
  );

  /** Fetch older sessions when the calendar is moved before the loaded window. */
  const pendingRange = useRef(null);
  const ensureRange = useCallback(async (from) => {
    if (!loadedFrom.current || from >= loadedFrom.current) return;
    if (pendingRange.current && pendingRange.current <= from) return;
    pendingRange.current = from;
    try {
      const older = await api.listSessions({ start: from, end: loadedFrom.current });
      setSessions((prev) => mergeSessions(prev, older));
      // Fetches can finish out of order when paging quickly; keep the earliest edge
      if (from < loadedFrom.current) loadedFrom.current = from;
    } catch {
      setNotice({ id: Date.now(), text: "Couldn't load that month" });
    } finally {
      pendingRange.current = null;
    }
  }, []);

  const bumpTotal = (projectId, seconds) =>
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, total_seconds: p.total_seconds + seconds } : p))
    );

  // ── Timer ──────────────────────────────────────────────────────────────────

  const startTimer = useCallback(
    (projectId) =>
      attempt(async () => {
        const current = sessionsRef.current.find((s) => !s.end);
        if (current?.project_id === projectId) return;
        const now = new Date();
        const tempId = `temp-${now.getTime()}`;
        // Optimistic: close whatever was running and start the new one immediately
        if (current) bumpTotal(current.project_id, (now - current.start) / 1000);
        setSessions((prev) =>
          prev
            .map((s) => (s.end ? s : { ...s, end: now }))
            .concat({ id: tempId, project_id: projectId, start: now, end: null, note: "" })
        );
        const started = await api.startTimer(projectId);
        setSessions((prev) => prev.map((s) => (s.id === tempId ? started : s)));
        if (current) refreshProjects();
      }),
    [attempt, refreshProjects]
  );

  const stopTimer = useCallback(
    () =>
      attempt(async () => {
        const current = sessionsRef.current.find((s) => !s.end);
        if (!current) return;
        const now = new Date();
        bumpTotal(current.project_id, (now - current.start) / 1000);
        setSessions((prev) => prev.map((s) => (s.id === current.id ? { ...s, end: now } : s)));
        const stopped = await api.stopTimer();
        if (stopped) setSessions((prev) => prev.map((s) => (s.id === stopped.id ? stopped : s)));
        refreshProjects();
      }),
    [attempt, refreshProjects]
  );

  // ── Sessions ───────────────────────────────────────────────────────────────

  const addSession = useCallback(
    (data) =>
      attempt(async () => {
        const created = await api.createSession(data);
        setSessions((prev) => mergeSessions(prev, [created]));
        refreshProjects();
      }),
    [attempt, refreshProjects]
  );

  const updateSession = useCallback(
    (id, data) =>
      attempt(async () => {
        const updated = await api.updateSession(id, data);
        setSessions((prev) => mergeSessions(prev, [updated]));
        refreshProjects();
      }),
    [attempt, refreshProjects]
  );

  const deleteSession = useCallback(
    (id) =>
      attempt(async () => {
        setSessions((prev) => prev.filter((s) => s.id !== id));
        await api.deleteSession(id);
        refreshProjects();
      }),
    [attempt, refreshProjects]
  );

  // ── Projects ───────────────────────────────────────────────────────────────

  const createProject = useCallback(
    (data) =>
      attempt(async () => {
        const created = await api.createProject(data);
        setProjects((prev) => [...prev, created]);
      }),
    [attempt]
  );

  const updateProject = useCallback(
    (id, data) =>
      attempt(async () => {
        const updated = await api.updateProject(id, data);
        setProjects((prev) => prev.map((p) => (p.id === id ? updated : p)));
      }),
    [attempt]
  );

  const deleteProject = useCallback(
    (id) =>
      attempt(async () => {
        setProjects((prev) => prev.filter((p) => p.id !== id));
        setSessions((prev) => prev.filter((s) => s.project_id !== id));
        await api.deleteProject(id);
      }),
    [attempt]
  );

  const running = useMemo(() => sessions.find((s) => !s.end) ?? null, [sessions]);
  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    projects,
    sessions,
    running,
    status,
    notice,
    dismissNotice,
    reload: load,
    ensureRange,
    startTimer,
    stopTimer,
    addSession,
    updateSession,
    deleteSession,
    createProject,
    updateProject,
    deleteProject,
  };
}
