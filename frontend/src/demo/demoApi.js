// In-memory stand-in for the real API, used by the public demo on the landing
// page. Same methods and shapes as api.js, so the real components run on it
// untouched. Nothing leaves the browser, and a reload starts over.

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

// Each project works in its own slice of the day, so sample days never show two
// projects at the same time. Hours are local; minutes are snapped to 5.
const PROJECTS = [
  {
    name: "Portfolio site", color: "#2f5d8a", icon: "code", status: "active",
    from: 150, until: 0, weekday: 0.62, weekend: 0.3,
    slot: { weekday: [18, 19, 45, 140], weekend: [14, 15, 60, 150] },
    notes: ["Hero layout", "Contact form", "Case study copy", "Mobile nav fixes", ""],
  },
  {
    name: "Spanish lessons", color: "#3a744b", icon: "school", status: "active",
    from: 240, until: 0, weekday: 0.78, weekend: 0.6,
    slot: { weekday: [7, 7.75, 20, 45], weekend: [7, 7.75, 20, 45] },
    notes: ["Past tense drills", "Podcast episode", "Vocabulary cards", "", ""],
  },
  {
    name: "Guitar practice", color: "#8f6416", icon: "music", status: "active",
    from: 200, until: 0, weekday: 0.45, weekend: 0.5,
    slot: { weekday: [21.5, 22, 20, 50], weekend: [21.5, 22, 20, 50] },
    notes: ["Scales and chord changes", "Fingerpicking pattern", "New song", "", ""],
  },
  {
    name: "Short story", color: "#7a4a78", icon: "pen", status: "active",
    from: 120, until: 0, weekday: 0.12, weekend: 0.55,
    slot: { weekday: [9, 10, 30, 90], weekend: [9, 10.5, 60, 150] },
    notes: ["Draft of chapter two", "Edits on the ending", "", ""],
  },
  {
    name: "Home server", color: "#56606b", icon: "cpu", status: "active",
    from: 270, until: 0, weekday: 0, weekend: 0.22,
    slot: { weekday: [20, 20.5, 45, 90], weekend: [17.75, 18.5, 45, 120] },
    notes: ["Backup script", "Router config", ""],
  },
  {
    name: "Resume rewrite", color: "#a9542e", icon: "briefcase", status: "done",
    from: 175, until: 110, weekday: 0.5, weekend: 0,
    slot: { weekday: [12.5, 13, 30, 90], weekend: [12.5, 13, 30, 90] },
    notes: ["New summary", "Trim older roles", ""],
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
  let n = 1;

  PROJECTS.forEach((def, i) => {
    const project = {
      id: `demo-p${i + 1}`,
      name: def.name,
      color: def.color,
      icon: def.icon,
      status: def.status,
      sort_order: i + 1,
      created_at: new Date(now.getTime() - def.from * DAY).toISOString(),
    };
    projects.push(project);

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

  // One timer already running, so the page is alive on arrival
  const running = projects.find((p) => p.name === RUNNING_PROJECT);
  sessions.push({
    id: `demo-s${n++}`,
    project_id: running.id,
    start: new Date(now.getTime() - RUNNING_MINUTES * 60_000),
    end: null,
    note: "",
  });

  return { projects, sessions: sessions.sort((a, b) => a.start - b.start), nextId: n };
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/** A fresh demo: new sample year, nothing shared with any earlier one. */
export function createDemoApi() {
  const { projects: seededProjects, sessions: seededSessions, nextId } = seed(new Date());
  let projects = seededProjects;
  let sessions = seededSessions;
  let seq = nextId;
  const newId = () => `demo-s${seq++}`;

  const project = (id) => {
    const found = projects.find((p) => p.id === id);
    if (!found) throw httpError(404, "Project not found");
    return found;
  };
  const session = (id) => {
    const found = sessions.find((s) => s.id === id);
    if (!found) throw httpError(404, "Session not found");
    return found;
  };
  const running = () => sessions.find((s) => !s.end);
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

  // Same rules as the server, so the demo refuses what the real thing refuses
  const checkSpan = (start, end) => {
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
        status: "active",
        sort_order: Math.max(0, ...projects.map((p) => p.sort_order)) + 1,
        created_at: new Date().toISOString(),
      };
      projects = [...projects, created];
      return projectOut(created);
    },
    updateProject: async (id, data) => {
      const next = { ...project(id), ...data };
      projects = projects.map((p) => (p.id === id ? next : p));
      return projectOut(next);
    },
    deleteProject: async (id) => {
      project(id);
      projects = projects.filter((p) => p.id !== id);
      sessions = sessions.filter((s) => s.project_id !== id);
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
      if (current) replaceSession(current.id, { ...current, end: now });
      const started = { id: newId(), project_id: projectId, start: now, end: null, note: "" };
      sessions = [...sessions, started];
      return { ...started };
    },
    stopTimer: async () => {
      const current = running();
      return current ? replaceSession(current.id, { ...current, end: new Date() }) : null;
    },
  };
}
