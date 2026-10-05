import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api as realApi } from "../api";
import { heatmapStart, tooShort } from "../lib/time";

function mergeSessions(prev, incoming) {
  const byId = new Map(prev.map((s) => [s.id, s]));
  for (const s of incoming) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => a.start - b.start);
}

/** How `completed_at` changes when `data` is applied to a to-do: stamped when it gets ticked,
 *  cleared when unticked, as on the server. Shown at once; the server's value replaces it. */
const completion = (todo, data) =>
  "done" in data && data.done !== todo.done ? { completed_at: data.done ? new Date().toISOString() : null } : {};

/**
 * All app data and every mutation. Sessions are held as Date-parsed objects;
 * the running timer is simply the one session whose `end` is null.
 * Mutations return true on success; failures surface as a `notice` toast.
 * `api` is the data source: the real server, or the in-memory demo on the
 * landing page. It must stay the same object for the life of the component.
 */
export function useTracker(api = realApi) {
  const [projects, setProjects] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [todos, setTodos] = useState([]);
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
      const [p, st, td, s] = await Promise.all([
        api.listProjects(),
        api.listStatuses(),
        api.listTodos(),
        api.listSessions({ start: from }),
      ]);
      loadedFrom.current = from;
      setProjects(p);
      setStatuses(st);
      setTodos(td);
      setSessions(s);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await api.listProjects());
    } catch {
      // totals just stay slightly stale until the next refresh
    }
  }, [api]);

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
  }, [api]);

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
        // Optimistic: close whatever was running (or drop it, if it was only a blip)
        // and start the new one immediately
        const dropped = current && tooShort(current, now);
        if (current && !dropped) bumpTotal(current.project_id, (now - current.start) / 1000);
        setSessions((prev) =>
          prev
            .filter((s) => !(dropped && s.id === current.id))
            .map((s) => (s.end ? s : { ...s, end: now }))
            .concat({ id: tempId, project_id: projectId, start: now, end: null, note: "" })
        );
        const started = await api.startTimer(projectId);
        setSessions((prev) => prev.map((s) => (s.id === tempId ? started : s)));
        if (current) refreshProjects();
      }),
    [api, attempt, refreshProjects]
  );

  /** Stop the timer. A run under two minutes leaves nothing behind, unless `keep` (a pause) is set.
   *  The options are destructured so a click event passed straight in is harmless. */
  const stopTimer = useCallback(
    ({ keep = false } = {}) =>
      attempt(async () => {
        const current = sessionsRef.current.find((s) => !s.end);
        if (!current) return;
        const now = new Date();
        if (!keep && tooShort(current, now)) {
          setSessions((prev) => prev.filter((s) => s.id !== current.id));
        } else {
          bumpTotal(current.project_id, (now - current.start) / 1000);
          setSessions((prev) => prev.map((s) => (s.id === current.id ? { ...s, end: now } : s)));
        }
        const stopped = await api.stopTimer({ keep });
        if (stopped) setSessions((prev) => prev.map((s) => (s.id === stopped.id ? stopped : s)));
        refreshProjects();
      }),
    [api, attempt, refreshProjects]
  );

  // ── Sessions ───────────────────────────────────────────────────────────────

  const addSession = useCallback(
    (data) =>
      attempt(async () => {
        const created = await api.createSession(data);
        setSessions((prev) => mergeSessions(prev, [created]));
        refreshProjects();
      }),
    [api, attempt, refreshProjects]
  );

  const updateSession = useCallback(
    (id, data) =>
      attempt(async () => {
        const updated = await api.updateSession(id, data);
        setSessions((prev) => mergeSessions(prev, [updated]));
        refreshProjects();
      }),
    [api, attempt, refreshProjects]
  );

  const deleteSession = useCallback(
    (id) =>
      attempt(async () => {
        setSessions((prev) => prev.filter((s) => s.id !== id));
        await api.deleteSession(id);
        refreshProjects();
      }),
    [api, attempt, refreshProjects]
  );

  // ── Projects ───────────────────────────────────────────────────────────────

  const createProject = useCallback(
    (data) =>
      attempt(async () => {
        const created = await api.createProject(data);
        setProjects((prev) => [...prev, created]);
      }),
    [api, attempt]
  );

  const updateProject = useCallback(
    (id, data) =>
      attempt(async () => {
        const updated = await api.updateProject(id, data);
        setProjects((prev) => prev.map((p) => (p.id === id ? updated : p)));
      }),
    [api, attempt]
  );

  /** Move a project to another status (a drag on the board). Shows at once; a failure resyncs. */
  const moveProject = useCallback(
    (id, statusId) =>
      attempt(async () => {
        setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, status_id: statusId } : p)));
        await api.updateProject(id, { status_id: statusId });
      }),
    [api, attempt]
  );

  /** Send a project to the back of the Feed's queue. Shows at once; the server's moment replaces
   *  ours. Only `skipped_at` is taken from the answer, so a total that moved meanwhile isn't undone. */
  const skipProject = useCallback(
    (id) =>
      attempt(async () => {
        setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, skipped_at: new Date().toISOString() } : p)));
        const saved = await api.skipProject(id);
        setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, skipped_at: saved.skipped_at } : p)));
      }),
    [api, attempt]
  );

  /** Put a project away, or bring it back. Both show at once; the server's moment replaces ours.
   *  Only `archived_at` is taken from the answer, like a skip, so a total that moved meanwhile isn't undone. */
  const setArchived = useCallback(
    (id, archive) =>
      attempt(async () => {
        setProjects((prev) =>
          prev.map((p) => (p.id === id ? { ...p, archived_at: archive ? new Date().toISOString() : null } : p))
        );
        const saved = await (archive ? api.archiveProject(id) : api.restoreProject(id));
        setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, archived_at: saved.archived_at } : p)));
      }),
    [api, attempt]
  );
  const archiveProject = useCallback((id) => setArchived(id, true), [setArchived]);
  const restoreProject = useCallback((id) => setArchived(id, false), [setArchived]);

  const deleteProject = useCallback(
    (id) =>
      attempt(async () => {
        setProjects((prev) => prev.filter((p) => p.id !== id));
        setSessions((prev) => prev.filter((s) => s.project_id !== id));
        setTodos((prev) => prev.filter((x) => x.project_id !== id));
        await api.deleteProject(id);
      }),
    [api, attempt]
  );

  // ── Statuses ───────────────────────────────────────────────────────────────

  const statusOps = {
    create: (data) =>
      attempt(async () => {
        const created = await api.createStatus(data);
        setStatuses((prev) => [...prev, created]);
      }),
    update: (id, data) =>
      attempt(async () => {
        const updated = await api.updateStatus(id, data);
        setStatuses((prev) => prev.map((x) => (x.id === id ? updated : x)));
        // Marking a status finished stops a timer running in it, on the server: resync to see that
        if (data.is_done === true) load();
      }),
    remove: (id) =>
      attempt(async () => {
        await api.deleteStatus(id);
        setStatuses((prev) => prev.filter((x) => x.id !== id));
      }),
    /** Swap places with the neighbour above (-1) or below (+1). */
    move: (id, direction) =>
      attempt(async () => {
        const i = statuses.findIndex((x) => x.id === id);
        const a = statuses[i];
        const b = statuses[i + direction];
        if (!a || !b) return;
        const [ua, ub] = await Promise.all([
          api.updateStatus(a.id, { sort_order: b.sort_order }),
          api.updateStatus(b.id, { sort_order: a.sort_order }),
        ]);
        setStatuses((prev) =>
          prev.map((x) => (x.id === ua.id ? ua : x.id === ub.id ? ub : x)).sort((p, q) => p.sort_order - q.sort_order)
        );
      }),
  };

  // ── To-dos ─────────────────────────────────────────────────────────────────

  const todoOps = {
    add: (projectId, text) =>
      attempt(async () => {
        const created = await api.createTodo({ project_id: projectId, text });
        setTodos((prev) => [...prev, created]);
      }),
    // Ticking and deleting show at once; a failure resyncs from the server (see attempt)
    update: (id, data) =>
      attempt(async () => {
        setTodos((prev) => prev.map((x) => (x.id === id ? { ...x, ...data, ...completion(x, data) } : x)));
        const saved = await api.updateTodo(id, data);
        // The server stamps the real moment; adopt it unless a later click has already moved on
        setTodos((prev) =>
          prev.map((x) => (x.id === id && x.done === saved.done ? { ...x, completed_at: saved.completed_at } : x))
        );
      }),
    remove: (id) =>
      attempt(async () => {
        setTodos((prev) => prev.filter((x) => x.id !== id));
        await api.deleteTodo(id);
      }),
  };

  const running = useMemo(() => sessions.find((s) => !s.end) ?? null, [sessions]);
  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    projects,
    statuses,
    statusOps,
    todos,
    todoOps,
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
    moveProject,
    skipProject,
    archiveProject,
    restoreProject,
    deleteProject,
  };
}
