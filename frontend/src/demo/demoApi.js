// In-memory stand-in for the real API, used by the public demo on the landing
// page. Same methods and shapes as api.js, so the real components run on it
// untouched. Nothing leaves the browser, and a reload starts over.

import { tooShort } from "../lib/time";

const DAY = 86_400_000;
const HISTORY_DAYS = 280;

/** Small seeded PRNG: the sample year looks the same on every visit. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATUSES = [
  { id: "demo-t1", name: "Active", color: "#3a744b", is_done: false, is_pinned: false },
  { id: "demo-t2", name: "On hold", color: "#8f6416", is_done: false, is_pinned: false },
  { id: "demo-t3", name: "Done", color: "#56606b", is_done: true, is_pinned: false },
];

// Each project works in its own slice of the day, so sample days never show two
// projects at the same time. Hours are local; minutes are snapped to 5.
const PROJECTS = [
  {
    name: "Portfolio site", color: "#2f5d8a", icon: "code",
    status: "demo-t1",
    from: 150, until: 0, weekday: 0.62, weekend: 0.3,
    slot: { weekday: [18, 19, 45, 140], weekend: [14, 15, 60, 150] },
    notes: ["Hero layout", "Contact form", "Case study copy", "Mobile nav fixes", ""],
    projectNotes: "Goal: ship before the end of the month.\n\nCase studies go first. Keep the copy short and let the screenshots do the talking.",
    todos: [["Write the case study intro", false], ["Compress hero images", false], ["Fix mobile nav overlap", false], ["Pick a typeface", true]],
  },
  {
    name: "Spanish lessons", color: "#3a744b", icon: "school",
    status: "demo-t1",
    from: 240, until: 0, weekday: 0.78, weekend: 0.6,
    slot: { weekday: [7, 7.75, 20, 45], weekend: [7, 7.75, 20, 45] },
    notes: ["Past tense drills", "Podcast episode", "Vocabulary cards", "", ""],
    projectNotes: "Weekly rhythm: drills on weekdays, a podcast episode on weekends.",
    todos: [["Finish the unit on the subjunctive", false], ["Book a conversation session", false]],
  },
  {
    name: "Guitar practice", color: "#8f6416", icon: "music",
    status: "demo-t1",
    from: 200, until: 0, weekday: 0.45, weekend: 0.5,
    slot: { weekday: [21.5, 22, 20, 50], weekend: [21.5, 22, 20, 50] },
    notes: ["Scales and chord changes", "Fingerpicking pattern", "New song", "", ""],
    todos: [["Learn the chorus of the new song", false], ["Restring the guitar", false]],
  },
  {
    name: "Short story", color: "#7a4a78", icon: "pen",
    status: "demo-t2",
    from: 120, until: 0, weekday: 0.12, weekend: 0.55,
    slot: { weekday: [9, 10, 30, 90], weekend: [9, 10.5, 60, 150] },
    notes: ["Draft of chapter two", "Edits on the ending", "", ""],
  },
  {
    name: "Home server", color: "#56606b", icon: "cpu",
    status: "demo-t1",
    from: 270, until: 0, weekday: 0, weekend: 0.22,
    slot: { weekday: [20, 20.5, 45, 90], weekend: [17.75, 18.5, 45, 120] },
    notes: ["Backup script", "Router config", ""],
    todos: [["Test restoring from a backup", false]],
  },
  {
    name: "Resume rewrite", color: "#a9542e", icon: "briefcase",
    status: "demo-t3",
    from: 175, until: 110, weekday: 0.5, weekend: 0,
    slot: { weekday: [12.5, 13, 30, 90], weekend: [12.5, 13, 30, 90] },
    notes: ["New summary", "Trim older roles", ""],
  },
  // Put away once it was done, so the archive drawer isn't empty on arrival. Kept last so the
  // seeded random numbers behind every other project's sessions don't move.
  {
    name: "Tax paperwork", color: "#7a4a78", icon: "briefcase",
    status: "demo-t3", archived: true,
    from: 255, until: 215, weekday: 0.4, weekend: 0.1,
    slot: { weekday: [19.5, 20, 30, 75], weekend: [11, 11.5, 30, 75] },
    notes: ["Receipts sorted", "Filed the return", ""],
  },
];

const RUNNING_PROJECT = "Portfolio site";
const RUNNING_MINUTES = 24;

function at(day, hour) {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(hour), Math.round((hour % 1) * 60));
}

const snap5 = (minutes) => Math.round(minutes / 5) * 5;

function seed(now) {
  const rand = mulberry32(2718);
  const cutoff = now.getTime() - (RUNNING_MINUTES + 2) * 60_000; // keep clear of the running timer
  const projects = [];
  const sessions = [];
  const todos = [];
  let n = 1;

  PROJECTS.forEach((def, i) => {
    const project = {
      id: `demo-p${i + 1}`,
      name: def.name,
      color: def.color,
      icon: def.icon,
      status_id: def.status,
      notes: def.projectNotes ?? "",
      sort_order: i + 1,
      created_at: new Date(now.getTime() - def.from * DAY).toISOString(),
      skipped_at: null,
      archived_at: def.archived ? new Date(now.getTime() - def.until * DAY).toISOString() : null,
    };
    projects.push(project);
    (def.todos ?? []).forEach(([text, done], k) => {
      todos.push({
        id: `demo-d${todos.length + 1}`, project_id: project.id, parent_id: null, text, done, completed_at: null,
        sort_order: todos.length + 1, created_at: new Date(now.getTime() - (20 - k) * DAY).toISOString(),
      });
    });

    for (let back = Math.min(def.from, HISTORY_DAYS); back >= def.until; back--) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
      const weekend = day.getDay() === 0 || day.getDay() === 6;
      // Older weeks are a little quieter, so the year reads as a habit that grew
      const ramp = 0.55 + 0.45 * (1 - back / HISTORY_DAYS);
      if (rand() > (weekend ? def.weekend : def.weekday) * ramp) continue;

      const [from, to, min, max] = weekend ? def.slot.weekend : def.slot.weekday;
      const start = at(day, snap5((from + rand() * (to - from)) * 60) / 60);
      const end = new Date(start.getTime() + snap5(min + rand() * (max - min)) * 60_000);
      if (end.getTime() > cutoff) continue;
      sessions.push({
        id: `demo-s${n++}`,
        project_id: project.id,
        start,
        end,
        note: def.notes[Math.floor(rand() * def.notes.length)],
      });
    }
  });

  // Finished to-dos were ticked off midway through their project's latest session, so that
  // session lists them
  for (const todo of todos) {
    if (!todo.done) continue;
    const last = sessions.filter((s) => s.project_id === todo.project_id).at(-1);
    if (last) todo.completed_at = new Date((last.start.getTime() + last.end.getTime()) / 2).toISOString();
  }

  // One timer already running, so the page is alive on arrival
  const running = projects.find((p) => p.name === RUNNING_PROJECT);
  sessions.push({
    id: `demo-s${n++}`,
    project_id: running.id,
    start: new Date(now.getTime() - RUNNING_MINUTES * 60_000),
    end: null,
    note: "",
  });

  return { projects, todos, sessions: sessions.sort((a, b) => a.start - b.start), nextId: n };
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/** A fresh demo: new sample year, nothing shared with any earlier one. */
export function createDemoApi() {
  const { projects: seededProjects, todos: seededTodos, sessions: seededSessions, nextId } = seed(new Date());
  let projects = seededProjects;
  let todos = seededTodos;
  let statuses = STATUSES.map((s, i) => ({ ...s, sort_order: i + 1 }));
  let sessions = seededSessions;
  let pomodoros = [];
  let seq = nextId;
  const newId = () => `demo-s${seq++}`;

  const project = (id) => {
    const found = projects.find((p) => p.id === id);
    if (!found) throw httpError(404, "Project not found");
    return found;
  };
  const todo = (id) => {
    const found = todos.find((x) => x.id === id);
    if (!found) throw httpError(404, "To-do not found");
    return found;
  };
  const session = (id) => {
    const found = sessions.find((s) => s.id === id);
    if (!found) throw httpError(404, "Session not found");
    return found;
  };
  const running = () => sessions.find((s) => !s.end);
  // A finished project has no timer: stop the running one if its project matches
  const stopTimerIf = (matches) => {
    const current = running();
    const owner = current && projects.find((p) => p.id === current.project_id);
    if (owner && matches(owner)) endTimer(current, new Date());
  };
  /** Close a running session, or drop it if it was too short to keep (null then). A pause keeps it. */
  const endTimer = (current, now, keep = false) => {
    if (!keep && tooShort(current, now)) {
      sessions = sessions.filter((s) => s.id !== current.id);
      return null;
    }
    return replaceSession(current.id, { ...current, end: now });
  };
  const replaceSession = (id, next) => {
    sessions = sessions.map((s) => (s.id === id ? next : s));
    return { ...next };
  };

  /** Closed-session seconds per project, as the server reports them. */
  const projectOut = (p) => ({
    ...p,
    total_seconds: Math.floor(
      sessions.reduce((sum, s) => (s.project_id === p.id && s.end ? sum + (s.end - s.start) / 1000 : sum), 0)
    ),
  });

  const status = (id) => {
    const found = statuses.find((s) => s.id === id);
    if (!found) throw httpError(404, "Status not found");
    return found;
  };
  const firstOpen = () => [...statuses].sort((a, b) => a.sort_order - b.sort_order).find((s) => !s.is_done);
  const nextOrder = (list) => Math.max(0, ...list.map((x) => x.sort_order)) + 1;
  const uniqueName = (list, name, label, exceptId) => {
    if (list.some((x) => x.id !== exceptId && x.name.toLowerCase() === name.toLowerCase()))
      throw httpError(409, `There is already a ${label} called \u201c${name}\u201d`);
  };
  const openLeft = (exceptId) => statuses.filter((s) => !s.is_done && s.id !== exceptId).length;

  // Same rules as the server, so the demo refuses what the real thing refuses
  const checkSpan = (start, end) => {
    if (!end) return; // a running session has no end yet
    if (end <= start) throw httpError(422, "End must be after start");
    if (end > Date.now() + 60_000) throw httpError(422, "End can't be in the future");
  };

  return {
    listProjects: async () => [...projects].sort((a, b) => a.sort_order - b.sort_order).map(projectOut),
    createProject: async (data) => {
      const created = {
        id: `demo-p${seq++}`,
        name: data.name,
        color: data.color,
        icon: data.icon,
        notes: data.notes ?? "",
        status_id: data.status_id ? status(data.status_id).id : firstOpen().id,
        sort_order: Math.max(0, ...projects.map((p) => p.sort_order)) + 1,
        created_at: new Date().toISOString(),
        skipped_at: null,
        archived_at: null,
      };
      projects = [...projects, created];
      return projectOut(created);
    },
    updateProject: async (id, data) => {
      project(id);
      if ("status_id" in data) {
        if (!data.status_id) throw httpError(422, "A project always has a status");
        if (status(data.status_id).is_done) stopTimerIf((p) => p.id === id);
      }
      const next = { ...project(id), ...data };
      projects = projects.map((p) => (p.id === id ? next : p));
      return projectOut(next);
    },
    skipProject: async (id) => {
      const next = { ...project(id), skipped_at: new Date().toISOString() };
      projects = projects.map((p) => (p.id === id ? next : p));
      return projectOut(next);
    },
    archiveProject: async (id) => {
      const current = project(id);
      stopTimerIf((p) => p.id === id); // an archived project has no timer
      const next = { ...current, archived_at: current.archived_at ?? new Date().toISOString() };
      projects = projects.map((p) => (p.id === id ? next : p));
      return projectOut(next);
    },
    restoreProject: async (id) => {
      const next = { ...project(id), archived_at: null };
      projects = projects.map((p) => (p.id === id ? next : p));
      return projectOut(next);
    },
    deleteProject: async (id) => {
      project(id);
      projects = projects.filter((p) => p.id !== id);
      sessions = sessions.filter((s) => s.project_id !== id);
      todos = todos.filter((x) => x.project_id !== id);
      return null;
    },

    listStatuses: async () => [...statuses].sort((a, b) => a.sort_order - b.sort_order),
    createStatus: async (data) => {
      uniqueName(statuses, data.name, "status");
      const created = {
        id: `demo-t${seq++}`, name: data.name, color: data.color ?? "#56606b",
        is_done: Boolean(data.is_done), is_pinned: false, sort_order: nextOrder(statuses),
      };
      statuses = [...statuses, created];
      return { ...created };
    },
    updateStatus: async (id, data) => {
      const current = status(id);
      if (data.name) uniqueName(statuses, data.name, "status", id);
      if (data.is_done && !current.is_done) {
        if (openLeft(id) === 0) throw httpError(409, "Keep at least one status that isn't marked done");
        stopTimerIf((p) => p.status_id === id);
      }
      const next = { ...current, ...data };
      // Only one status is pinned: pinning this one unpins the rest
      statuses = statuses.map((s) => (s.id === id ? next : data.is_pinned ? { ...s, is_pinned: false } : s));
      return { ...next };
    },
    deleteStatus: async (id) => {
      const current = status(id);
      const inUse = projects.filter((p) => p.status_id === id).length;
      if (inUse) {
        const [noun, pronoun] = inUse === 1 ? ["project", "it"] : ["projects", "them"];
        throw httpError(409, `${inUse} ${noun} still use this status. Move ${pronoun} to another status first.`);
      }
      if (!current.is_done && openLeft(id) === 0) throw httpError(409, "Keep at least one status that isn't marked done");
      statuses = statuses.filter((s) => s.id !== id);
      return null;
    },

    listTodos: async () => [...todos].sort((a, b) => a.sort_order - b.sort_order).map((x) => ({ ...x })),
    createTodo: async (data) => {
      project(data.project_id);
      const text = data.text.trim();
      if (!text) throw httpError(422, "Write something first");
      const parent = data.parent_id ? todo(data.parent_id) : null;
      if (parent && (parent.project_id !== data.project_id || parent.parent_id)) {
        throw httpError(422, "A sub-to-do goes under a top-level to-do of the same project");
      }
      const created = {
        id: `demo-d${seq++}`, project_id: data.project_id, parent_id: parent?.id ?? null, text, done: false, completed_at: null,
        sort_order: Math.max(0, ...todos.map((x) => x.sort_order)) + 1, created_at: new Date().toISOString(),
      };
      todos = [...todos, created];
      return { ...created };
    },
    updateTodo: async (id, data) => {
      const current = todo(id);
      const next = { ...current, ...data };
      if ("done" in data && data.done !== current.done) next.completed_at = data.done ? new Date().toISOString() : null;
      todos = todos.map((x) => (x.id === id ? next : x));
      return { ...next };
    },
    deleteTodo: async (id) => {
      todo(id);
      todos = todos.filter((x) => x.id !== id && x.parent_id !== id);
      return null;
    },

    listSessions: async ({ start, end } = {}) =>
      sessions
        .filter((s) => (!end || s.start < end) && (!start || !s.end || s.end > start))
        .map((s) => ({ ...s })),
    createSession: async (data) => {
      project(data.project_id);
      checkSpan(data.start, data.end);
      const created = { id: newId(), project_id: data.project_id, start: data.start, end: data.end, note: data.note ?? "" };
      sessions = [...sessions, created].sort((a, b) => a.start - b.start);
      return { ...created };
    },
    updateSession: async (id, data) => {
      const current = session(id);
      if (data.project_id) project(data.project_id);
      const next = { ...current, ...data };
      checkSpan(next.start, next.end);
      return replaceSession(id, next);
    },
    deleteSession: async (id) => {
      session(id);
      sessions = sessions.filter((s) => s.id !== id);
      return null;
    },

    startTimer: async (projectId) => {
      project(projectId);
      const current = running();
      if (current?.project_id === projectId) return { ...current };
      const now = new Date();
      if (current) endTimer(current, now);
      const started = { id: newId(), project_id: projectId, start: now, end: null, note: "" };
      sessions = [...sessions, started];
      return { ...started };
    },
    stopTimer: async ({ keep = false } = {}) => {
      const current = running();
      return current ? endTimer(current, new Date(), keep) : null;
    },

    listPomodoros: async ({ start, end } = {}) =>
      pomodoros.filter((p) => (!end || p.start < end) && (!start || p.end > start)).map((p) => ({ ...p })),
    createPomodoro: async (data) => {
      checkSpan(data.start, data.end);
      const created = { id: `demo-m${seq++}`, start: data.start, end: data.end, completed: data.completed ?? true };
      pomodoros = [...pomodoros, created].sort((a, b) => a.start - b.start);
      return { ...created };
    },
  };
}
