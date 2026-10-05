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

/** API sessions carry ISO strings; the app works with Date objects. */
export function parseSession(s) {
  return { ...s, start: new Date(s.start), end: s.end ? new Date(s.end) : null };
}

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

  startTimer: async (projectId) =>
    parseSession(await fetchApi("/timer/start", json("POST", { project_id: projectId }))),
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
};

function serialize(data) {
  const out = { ...data };
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
