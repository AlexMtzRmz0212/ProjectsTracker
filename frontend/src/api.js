// Thin client for the FastAPI backend. Every route is under /api; in dev Vite
// proxies that to the Python server (see vite.config.js).

const BASE = "/api";

/** fetch wrapper: checks the status before parsing, and tolerates 204s. */
export async function fetchApi(path, options = {}) {
  const response = await fetch(BASE + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });

  if (!response.ok) {
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

export const api = {
  listProjects: () => fetchApi("/projects"),
  createProject: (data) => fetchApi("/projects", json("POST", data)),
  updateProject: (id, data) => fetchApi(`/projects/${id}`, json("PATCH", data)),
  deleteProject: (id) => fetchApi(`/projects/${id}`, { method: "DELETE" }),

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
  stopTimer: async () => {
    const s = await fetchApi("/timer/stop", { method: "POST" });
    return s ? parseSession(s) : null;
  },
};

function serialize(data) {
  const out = { ...data };
  if (out.start instanceof Date) out.start = out.start.toISOString();
  if (out.end instanceof Date) out.end = out.end.toISOString();
  return out;
}
