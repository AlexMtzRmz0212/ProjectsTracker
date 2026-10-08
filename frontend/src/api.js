// Thin client for the FastAPI backend. Every route is under /api; in dev Vite
// proxies that to the Python server (see vite.config.js).

const BASE = "/api";
export const UNAUTHORIZED_EVENT = "pt-unauthorized";

/** fetch wrapper: checks the status before parsing, and tolerates 204s. */
export async function fetchApi(path, options = {}) {
  const response = await fetch(BASE + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });

  if (!response.ok) {
    // An expired owner session: let the app drop back to the public page. Login
    // itself answers 401 for a wrong password, which is not a session problem.
    if (response.status === 401 && !path.startsWith("/auth/")) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    const text = await response.text();
    let message = text;
    try {
      const detail = JSON.parse(text).detail;
      message = typeof detail === "string" ? detail : detail?.[0]?.msg ?? text;
    } catch {
      // not JSON; keep the raw text
    }
    const error = new Error(message || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) return null;
  return response.json();
}

const json = (method, body) => ({ method, body: JSON.stringify(body) });

// ── Subjects ────────────────────────────────────────────────────────────────
// Time is logged on a project or on a task (a to-do with no project). The server keeps the two apart
// (`project_id`, or `todo_id` alone); the app names whatever time is on by one id, its "subject": a
// project's id, or "task:" and the task's id. So the calendar, the stats and the timer, which all
// look a session up by `project_id`, work the same for both. The conversion happens here.

const TASK = "task:";
export const taskKey = (todoId) => TASK + todoId;
export const isTaskKey = (id) => typeof id === "string" && id.startsWith(TASK);
export const taskIdOf = (key) => key.slice(TASK.length);

/** The subject of something the server sent: its project, or its task. */
const subjectOf = (row) => row.project_id ?? (row.todo_id ? taskKey(row.todo_id) : null);

/** The server's fields for a subject id (and the project to-do it names, if any). */
export function subjectFields(subjectId, todoId = null) {
  return isTaskKey(subjectId) ? { project_id: null, todo_id: taskIdOf(subjectId) } : { project_id: subjectId, todo_id: todoId };
}

/** API sessions carry ISO strings; the app works with Date objects, and a subject id in `project_id`. */
export function parseSession(s) {
  return { ...s, project_id: subjectOf(s), start: new Date(s.start), end: s.end ? new Date(s.end) : null };
}

/** An open item: like a session that hasn't ended. */
export const parseOpenItem = (item) => ({ ...item, project_id: subjectOf(item), start: new Date(item.start) });

export function parsePomodoro(p) {
  return { ...p, start: new Date(p.start), end: new Date(p.end) };
}

export const api = {
  listProjects: () => fetchApi("/projects"),
  createProject: (data) => fetchApi("/projects", json("POST", data)),
  updateProject: (id, data) => fetchApi(`/projects/${id}`, json("PATCH", data)),
  deleteProject: (id) => fetchApi(`/projects/${id}`, { method: "DELETE" }),
  skipProject: (id) => fetchApi(`/projects/${id}/skip`, { method: "POST" }),
  archiveProject: (id) => fetchApi(`/projects/${id}/archive`, { method: "POST" }),
  restoreProject: (id) => fetchApi(`/projects/${id}/restore`, { method: "POST" }),

  listStatuses: () => fetchApi("/statuses"),
  createStatus: (data) => fetchApi("/statuses", json("POST", data)),
  updateStatus: (id, data) => fetchApi(`/statuses/${id}`, json("PATCH", data)),
  deleteStatus: (id) => fetchApi(`/statuses/${id}`, { method: "DELETE" }),

  listTodos: () => fetchApi("/todos"),
  createTodo: (data) => fetchApi("/todos", json("POST", data)),
  updateTodo: (id, data) => fetchApi(`/todos/${id}`, json("PATCH", data)),
  deleteTodo: (id) => fetchApi(`/todos/${id}`, { method: "DELETE" }),

  listSessions: async ({ start, end } = {}) => {
    const params = new URLSearchParams();
    if (start) params.set("start", start.toISOString());
    if (end) params.set("end", end.toISOString());
    const qs = params.toString();
    const rows = await fetchApi(`/sessions${qs ? `?${qs}` : ""}`);
    return rows.map(parseSession);
  },
  createSession: async (data) => parseSession(await fetchApi("/sessions", json("POST", serialize(data)))),
  updateSession: async (id, data) =>
    parseSession(await fetchApi(`/sessions/${id}`, json("PATCH", serialize(data)))),
  deleteSession: (id) => fetchApi(`/sessions/${id}`, { method: "DELETE" }),

  /** Start the timer on a project or a task; on a project, `todoId` names the to-do being timed. */
  startTimer: async (subjectId, todoId = null) =>
    parseSession(await fetchApi("/timer/start", json("POST", subjectFields(subjectId, todoId)))),
  stopTimer: async ({ keep = false } = {}) => {
    const s = await fetchApi(`/timer/stop${keep ? "?keep=true" : ""}`, { method: "POST" });
    return s ? parseSession(s) : null;
  },

  listPomodoros: async ({ start, end } = {}) => {
    const params = new URLSearchParams();
    if (start) params.set("start", start.toISOString());
    if (end) params.set("end", end.toISOString());
    const qs = params.toString();
    const rows = await fetchApi(`/pomodoros${qs ? `?${qs}` : ""}`);
    return rows.map(parsePomodoro);
  },
  createPomodoro: async (data) => parsePomodoro(await fetchApi("/pomodoros", json("POST", serialize(data)))),

  listOpenItems: async () => (await fetchApi("/open-items")).map(parseOpenItem),
  createOpenItem: async (data) => parseOpenItem(await fetchApi("/open-items", json("POST", serialize(data)))),
  updateOpenItem: async (id, data) => parseOpenItem(await fetchApi(`/open-items/${id}`, json("PATCH", serialize(data)))),
  /** Close it at `end` (now if left out); it comes back as the session it became. */
  closeOpenItem: async (id, { end } = {}) =>
    parseSession(await fetchApi(`/open-items/${id}/close`, json("POST", serialize({ end })))),
  deleteOpenItem: (id) => fetchApi(`/open-items/${id}`, { method: "DELETE" }),
};

/** Dates as ISO strings, and a subject id as the server's project_id / todo_id. */
function serialize(data) {
  const out = { ...data, ...("project_id" in data ? subjectFields(data.project_id, data.todo_id ?? null) : {}) };
  if (out.start instanceof Date) out.start = out.start.toISOString();
  if (out.end instanceof Date) out.end = out.end.toISOString();
  return out;
}

/** Owner login. The session lives in an HttpOnly cookie, so JS never sees a token. */
export const auth = {
  me: () => fetchApi("/auth/me"),
  login: (password) => fetchApi("/auth/login", json("POST", { password })),
  logout: () => fetchApi("/auth/logout", { method: "POST" }),
};

/** The public "I'd use this" counter on the landing page, plus the owner's inbox
 *  of what visitors wrote (inbox and removeMessage need the owner session). */
export const interest = {
  get: () => fetchApi("/interest"),
  add: (visitorId) => fetchApi("/interest", json("POST", { visitor_id: visitorId })),
  send: (visitorId, { email, message }) =>
    fetchApi("/interest/message", json("POST", { visitor_id: visitorId, email, message })),
  inbox: async () => {
    const inbox = await fetchApi("/interest/messages");
    return { ...inbox, messages: inbox.messages.map((m) => ({ ...m, created_at: new Date(m.created_at) })) };
  },
  removeMessage: (id) => fetchApi(`/interest/messages/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
