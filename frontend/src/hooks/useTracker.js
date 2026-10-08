import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api as realApi, taskKey } from "../api";
import { heatmapStart, tooShort } from "../lib/time";

/** `prev` and `incoming` merged by id, earliest first. Works for sessions and pomodoros alike. */
function mergeSessions(prev, incoming) {
  const byId = new Map(prev.map((s) => [s.id, s]));
  for (const s of incoming) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => a.start - b.start);
}

/** How `completed_at` changes when `data` is applied to a to-do: stamped when it gets ticked,
 *  cleared when unticked, as on the server. Shown at once; the server's value replaces it. */
const completion = (todo, data) =>
  "done" in data && data.done !== todo.done ? { completed_at: data.done ? new Date().toISOString() : null } : {};

/** A change to a to-do as it shows at once: `working` becomes when it started being worked on (kept if it
 *  already was), and ticking it off ends that, as on the server. */
function applyTodo(todo, data) {
  const { working, ...rest } = data;
  const next = { ...todo, ...rest, ...completion(todo, data) };
  if (working !== undefined) next.working_since = working ? todo.working_since ?? new Date().toISOString() : null;
  if (next.done) next.working_since = null;
  return next;
}

/**
 * All app data and every mutation. Sessions are held as Date-parsed objects;
 * the running timer is simply the one session whose `end` is null.
 * Mutations return true on success; failures surface as a `notice` toast.
 * `api` is the data source: the real server, or the in-memory demo on the
 * landing page. It must stay the same object for the life of the component.
 */
export function useTracker(api = realApi) {
  const [projects, setProjects] = useState([]);
  const projectsRef = useRef(projects); // what a drag on the board reads, so the callback needn't change with it
  projectsRef.current = projects;
  const [statuses, setStatuses] = useState([]);
  const [todos, setTodos] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [pomodoros, setPomodoros] = useState([]);
  const [openItems, setOpenItems] = useState([]); // started, to be closed later; they run alongside the timer
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [notice, setNotice] = useState(null);
  const loadedFrom = useRef(null);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  const load = useCallback(async () => {
    setStatus((s) => (s === "ready" ? s : "loading"));
    try {
      const from = heatmapStart(new Date());
      const [p, st, td, s, pm, oi] = await Promise.all([
        api.listProjects(),
        api.listStatuses(),
        api.listTodos(),
        api.listSessions({ start: from }),
        api.listPomodoros({ start: from }),
        api.listOpenItems(),
      ]);
      loadedFrom.current = from;
      setProjects(p);
      setStatuses(st);
      setTodos(td);
      setSessions(s);
      setPomodoros(pm);
      setOpenItems(oi);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  /** Fresh totals after time was logged: the projects', and the tasks' (only their totals are taken,
   *  so a to-do ticked meanwhile isn't undone). */
  const refreshProjects = useCallback(async () => {
    try {
      const [fresh, freshTodos] = await Promise.all([api.listProjects(), api.listTodos()]);
      setProjects(fresh);
      const totals = new Map(freshTodos.map((x) => [x.id, x.total_seconds]));
      setTodos((prev) => prev.map((x) => (totals.has(x.id) && totals.get(x.id) !== x.total_seconds ? { ...x, total_seconds: totals.get(x.id) } : x)));
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
      const [older, olderPomodoros] = await Promise.all([
        api.listSessions({ start: from, end: loadedFrom.current }),
        api.listPomodoros({ start: from, end: loadedFrom.current }),
      ]);
      setSessions((prev) => mergeSessions(prev, older));
      setPomodoros((prev) => mergeSessions(prev, olderPomodoros));
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

  /** Start the timer on a project (or task); `todoId` times one of the project's to-dos. Starting it on
   *  another to-do of the same project closes the running session and opens one for that to-do. */
  const startTimer = useCallback(
    (projectId, todoId = null) =>
      attempt(async () => {
        const current = sessionsRef.current.find((s) => !s.end);
        if (current?.project_id === projectId && (current.todo_id ?? null) === todoId) return;
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
            .concat({ id: tempId, project_id: projectId, todo_id: todoId, start: now, end: null, note: "" })
        );
        const started = await api.startTimer(projectId, todoId);
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

  // ── Pomodoros ──────────────────────────────────────────────────────────────

  /** Save a finished focus ({ start, end }). The pomodoro hook calls this when a countdown runs out. */
  const addPomodoro = useCallback(
    (data) =>
      attempt(async () => {
        const created = await api.createPomodoro(data);
        setPomodoros((prev) => mergeSessions(prev, [created]));
      }),
    [api, attempt]
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

  /** Drop a project into a status's column (a drag on the board), at `index` among the cards that
   *  are there (the end when it isn't given). The column's cards trade the sort_order values they
   *  already hold, so nothing outside it is touched. Shows at once; a failure resyncs. */
  const moveProject = useCallback(
    (id, statusId, index) =>
      attempt(async () => {
        const all = projectsRef.current;
        const moved = all.find((p) => p.id === id);
        if (!moved) return;
        const column = all.filter((p) => p.status_id === statusId && !p.archived_at && p.id !== id);
        const at = index == null ? column.length : Math.min(Math.max(index, 0), column.length);
        const ordered = [...column.slice(0, at), moved, ...column.slice(at)];
        const slots = [...column, moved].map((p) => p.sort_order).sort((a, b) => a - b);
        const changes = new Map();
        ordered.forEach((p, i) => {
          const patch = {};
          if (p.sort_order !== slots[i]) patch.sort_order = slots[i];
          if (p.id === id && p.status_id !== statusId) patch.status_id = statusId;
          if (Object.keys(patch).length) changes.set(p.id, patch);
        });
        if (changes.size === 0) return;
        setProjects((prev) =>
          prev.map((p) => (changes.has(p.id) ? { ...p, ...changes.get(p.id) } : p)).sort((a, b) => a.sort_order - b.sort_order)
        );
        await Promise.all([...changes].map(([pid, patch]) => api.updateProject(pid, patch)));
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
        setOpenItems((prev) => prev.filter((x) => x.project_id !== id));
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
        // Pinning one unpins the rest, on the server too
        setStatuses((prev) =>
          prev.map((x) => (x.id === id ? updated : data.is_pinned && x.is_pinned ? { ...x, is_pinned: false } : x))
        );
        // Marking a status finished stops a timer running in it, on the server: resync to see that
        if (data.is_done === true) load();
      }),
    remove: (id) =>
      attempt(async () => {
        await api.deleteStatus(id);
        setStatuses((prev) => prev.filter((x) => x.id !== id));
      }),
    /** Put the statuses in the order of `ids` (all of them, top first). Shows at once; a failure resyncs. */
    reorder: (ids) =>
      attempt(async () => {
        const byId = new Map(statuses.map((x) => [x.id, x]));
        // The same sort_order values, handed out again in the new order
        const slots = statuses.map((x) => x.sort_order).sort((a, b) => a - b);
        const next = ids.map((id, i) => ({ ...byId.get(id), sort_order: slots[i] }));
        setStatuses(next);
        await Promise.all(
          next.filter((x) => x.sort_order !== byId.get(x.id).sort_order).map((x) => api.updateStatus(x.id, { sort_order: x.sort_order }))
        );
      }),
  };

  // ── To-dos ─────────────────────────────────────────────────────────────────

  const todoOps = {
    /** A to-do on a project, or with no project (`projectId` null), a task of its own. */
    add: (projectId, text, parentId = null) =>
      attempt(async () => {
        const created = await api.createTodo({ project_id: projectId, text, parent_id: parentId });
        setTodos((prev) => [...prev, created]);
      }),
    // Ticking and deleting show at once; a failure resyncs from the server (see attempt)
    update: (id, data) =>
      attempt(async () => {
        setTodos((prev) => prev.map((x) => (x.id === id ? applyTodo(x, data) : x)));
        const saved = await api.updateTodo(id, data);
        // The server stamps the real moments; adopt them unless a later click has already moved on
        setTodos((prev) =>
          prev.map((x) =>
            x.id === id && x.done === saved.done && Boolean(x.working_since) === Boolean(saved.working_since)
              ? { ...x, completed_at: saved.completed_at, working_since: saved.working_since }
              : x
          )
        );
        // A task ticked off with its timer running: the server stopped the timer
        if (data.done && sessionsRef.current.some((x) => !x.end && x.project_id === taskKey(id))) load();
      }),
    /** Put these to-dos (one list: a project's open ones, a to-do's sub-to-dos...) in the order of
     *  `ids`. They trade the sort_order values they already hold, so other lists keep their places.
     *  Shows at once; a failure resyncs. */
    reorder: (ids) =>
      attempt(async () => {
        const byId = new Map(todos.map((x) => [x.id, x]));
        const slots = ids.map((id) => byId.get(id).sort_order).sort((a, b) => a - b);
        const changed = new Map(ids.map((id, i) => [id, slots[i]]).filter(([id, order]) => byId.get(id).sort_order !== order));
        if (changed.size === 0) return;
        setTodos((prev) =>
          prev.map((x) => (changed.has(x.id) ? { ...x, sort_order: changed.get(x.id) } : x)).sort((a, b) => a.sort_order - b.sort_order)
        );
        await Promise.all([...changed].map(([id, order]) => api.updateTodo(id, { sort_order: order })));
      }),
    /** Move a to-do under another (`parentId`), or back to the top level (null). It goes to the end of its new
     *  list. A task put under another task hands its time over to it, so that is resynced from the server. */
    nest: (id, parentId) =>
      attempt(async () => {
        const moved = todos.find((x) => x.id === id);
        if (!moved || (moved.parent_id ?? null) === parentId) return;
        const last = Math.max(0, ...todos.map((x) => x.sort_order)) + 1;
        setTodos((prev) =>
          prev.map((x) => (x.id === id ? { ...x, parent_id: parentId, sort_order: last } : x)).sort((a, b) => a.sort_order - b.sort_order)
        );
        const saved = await api.updateTodo(id, { parent_id: parentId });
        setTodos((prev) => prev.map((x) => (x.id === id ? { ...x, sort_order: saved.sort_order } : x)));
        if (!moved.project_id && parentId) load();
      }),
    remove: (id) =>
      attempt(async () => {
        const gone = todos.find((x) => x.id === id);
        setTodos((prev) => prev.filter((x) => x.id !== id && x.parent_id !== id)); // its sub-to-dos go with it
        if (gone && !gone.project_id) {
          // A task's time and open items go with it
          setSessions((prev) => prev.filter((x) => x.project_id !== taskKey(id)));
          setOpenItems((prev) => prev.filter((x) => x.project_id !== taskKey(id)));
        }
        await api.deleteTodo(id);
      }),
  };

  // ── Open items ─────────────────────────────────────────────────────────────
  // Long pieces of work started and left open, any number, alongside the timer. Closing one turns it
  // into a session.

  const openOps = {
    /** Start one: { project_id (a subject id), start?, note? }. */
    start: (data) =>
      attempt(async () => {
        const created = await api.createOpenItem(data);
        setOpenItems((prev) => [...prev, created].sort((a, b) => a.start - b.start));
      }),
    update: (id, data) =>
      attempt(async () => {
        const updated = await api.updateOpenItem(id, data);
        setOpenItems((prev) => prev.map((x) => (x.id === id ? updated : x)).sort((a, b) => a.start - b.start));
      }),
    /** Close it at `end` (now if not given): it becomes a session. */
    close: (id, end) =>
      attempt(async () => {
        setOpenItems((prev) => prev.filter((x) => x.id !== id));
        const session = await api.closeOpenItem(id, { end });
        setSessions((prev) => mergeSessions(prev, [session]));
        refreshProjects();
      }),
    /** Throw it away: nothing is logged. */
    discard: (id) =>
      attempt(async () => {
        setOpenItems((prev) => prev.filter((x) => x.id !== id));
        await api.deleteOpenItem(id);
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
    pomodoros,
    addPomodoro,
    openItems,
    openOps,
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
