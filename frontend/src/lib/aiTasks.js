import { __ } from "../i18n";
// Working on the task list with an AI: the tasks go out as a prompt (copy it, paste it into any chat), the
// reply comes back as JSON, and what it suggests is shown as changes to review before they're applied.
// Estimates live in the task's own text, as a trailing "(~45m)" or "(~2h)", so nothing in the data changes.

const MAX_TEXT = 200; // the server's limit on a task's text
const MAX_SUBS = 12; // sub-tasks taken from one task's answer

const squash = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
// A sub-task is the same one with or without its estimate, so "Outline (~15m)" matches "Outline"
const keyOf = (text) => squash(text).replace(/\s*\(~[^()]*\)$/, "").toLowerCase();

/** The text to copy for an AI: the instructions, then the open tasks as JSON (with the sub-tasks already on them).
 *  `subsOf(task)` gives a task's open sub-tasks. */
export function buildPrompt(tasks, subsOf) {
  const list = tasks.map((task) => ({
    id: task.id,
    text: task.text,
    subtasks: subsOf(task).map((s) => s.text),
  }));
  return [
    "Help me plan my task list. Below are my open tasks as JSON. For every task:",
    '1. Break it into short, concrete sub-tasks (at most 8, each under 80 characters, in the order to do them). Keep the sub-tasks it already has, word for word (you may reorder them), and add new ones only for steps they don\'t cover.',
    '2. Estimate how long each sub-task takes, and put the estimate at the very end of the sub-task like "(~15m)" or "(~1h)". Do this for the sub-tasks it already has too: add or update only the estimate, never their wording.',
    '3. Estimate how long the whole task takes (about the sum of its sub-tasks), and put the estimate at the very end of its "text" like "(~45m)" or "(~2h)". Change nothing else in the text, and keep it under 190 characters.',
    "4. Sort the tasks in your answer from shortest to longest estimated total time (shortest first). Only the tasks are sorted this way; each task's sub-tasks stay in the order to do them.",
    "",
    "Reply with ONLY a JSON object. No markdown fences, no commentary. Keep every task's id exactly as given, and answer for every task:",
    '{"tasks":[{"id":"<id>","text":"<task text> (~45m)","subtasks":["<step> (~15m)","<step> (~30m)"]}]}',
    "",
    "My tasks:",
    JSON.stringify({ tasks: list }, null, 2),
  ].join("\n");
}

/** The JSON object in what an AI answered, which may be wrapped in a fence or in a sentence. */
function extractJson(raw) {
  const text = String(raw ?? "").trim();
  if (!text) throw new Error(__("Paste the AI's reply first."));
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const from = body.indexOf("{");
  const to = body.lastIndexOf("}");
  if (from < 0 || to <= from) throw new Error(__("Couldn't find any JSON in that reply."));
  try {
    return JSON.parse(body.slice(from, to + 1));
  } catch {
    throw new Error(__("That reply isn't valid JSON. Ask the AI to answer with only the JSON object."));
  }
}

/**
 * The ids of the tasks in the order the reply lists them (the prompt asks for shortest first), when that differs
 * from the order they are in now; an empty list when the order stays. `tasks` are the open tasks in their current order.
 */
export function planOrder(raw, tasks) {
  const data = extractJson(raw);
  const rows = Array.isArray(data) ? data : data?.tasks;
  if (!Array.isArray(rows)) return [];
  const known = new Set(tasks.map((t) => String(t.id)));
  const seen = new Set();
  const asked = [];
  for (const row of rows) {
    const id = String(row?.id);
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    asked.push(id);
  }
  const current = tasks.map((t) => String(t.id)).filter((id) => seen.has(id));
  const original = new Map(tasks.map((t) => [String(t.id), t.id]));
  return asked.length > 1 && asked.some((id, i) => id !== current[i]) ? asked.map((id) => original.get(id)) : [];
}

/**
 * What the reply changes, as one entry per task that would change: `{ task, text, addSubs, editSubs }`, where
 * `text` is the new text (null when it stays), `addSubs` the sub-tasks to add (those the task doesn't have yet) and
 * `editSubs` the sub-tasks it has whose text changes, as `{ sub, text }` (an estimate added, or a new one). Nothing
 * is ever removed. Throws an Error with a message for the person when the reply can't be used.
 * `tasks` are the open tasks the prompt was made from; `subsOf(task)` all the sub-tasks a task has.
 */
export function planChanges(raw, tasks, subsOf) {
  const data = extractJson(raw);
  const rows = Array.isArray(data) ? data : data?.tasks;
  if (!Array.isArray(rows)) throw new Error(__("The JSON needs a \"tasks\" list."));
  const byId = new Map(tasks.map((t) => [String(t.id), t]));
  const changes = [];
  let matched = 0;
  for (const row of rows) {
    const task = byId.get(String(row?.id));
    if (!task) continue;
    matched++;
    const text = squash(row.text).slice(0, MAX_TEXT);
    const existing = new Map(subsOf(task).map((s) => [keyOf(s.text), s]));
    const seen = new Set();
    const addSubs = [];
    const editSubs = [];
    for (const sub of Array.isArray(row.subtasks) ? row.subtasks : []) {
      const value = squash(typeof sub === "string" ? sub : sub?.text).slice(0, MAX_TEXT);
      const key = keyOf(value);
      if (!value || seen.has(key)) continue;
      seen.add(key);
      const have = existing.get(key);
      if (have) {
        // One it already has: only its estimate can change
        if (value !== have.text) editSubs.push({ sub: have, text: value });
      } else if (addSubs.length < MAX_SUBS) {
        addSubs.push(value);
      }
    }
    const newText = text && text !== task.text ? text : null;
    if (newText || addSubs.length || editSubs.length) changes.push({ task, text: newText, addSubs, editSubs });
  }
  if (matched === 0) throw new Error(__("None of the ids in that reply match your tasks. Copy the list again and ask the AI to keep the ids."));
  return changes;
}

const MAX_PICKS = 12; // what the plan prompt asks for at most

/**
 * The plan an AI answered with ({ "order": [{ "id", "why" }] }), as what to put on the plan in the order given:
 * `{ picks: [{ ...found, why }], unknown }`. `resolve(id)` turns one of the ids the prompt gave ("project:…", "todo:…",
 * "habit:…") into { kind, ref, name, context?, icon?, color? }, or null when it isn't there (any more);
 * `unknown` counts those. Throws an Error with a message for the person when the reply can't be used.
 */
export function planFromReply(raw, resolve) {
  const data = extractJson(raw);
  const rows = Array.isArray(data) ? data : data?.order ?? data?.plan;
  if (!Array.isArray(rows)) throw new Error(__("The JSON needs an \"order\" list."));
  const seen = new Set();
  const picks = [];
  let unknown = 0;
  for (const row of rows) {
    const id = squash(typeof row === "string" ? row : row?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const found = resolve(id);
    if (!found) unknown++;
    else if (picks.length < MAX_PICKS) picks.push({ ...found, why: squash(row?.why).slice(0, 200) });
  }
  if (picks.length === 0) throw new Error(__("None of the ids in that reply match what you can work on. Copy the prompt again and ask the AI to keep the ids."));
  return { picks, unknown };
}

/**
 * The text to copy for an AI to decide what to work on first: the instructions, then everything that could be worked on
 * as JSON. `data` is { now (text), projects, tasks, habits, plan }: the projects each with their open to-dos (and
 * those with their sub-to-dos), the tasks the same, the habits with their streaks, and the ids already lined
 * up in the plan, in order. Every thing has an `id` of its own ("project:...", "todo:...", "habit:..."), which
 * the reply has to use exactly. The AI answers with { order: [{ id, why }] }.
 */
export function buildPlanPrompt({ now, projects, tasks, habits, plan }) {
  const payload = { projects, tasks, habits, plan };
  return [
    `Help me decide what to work on first. Below is everything I could work on, as JSON: my open projects (each with its open to-dos), my tasks and my habits. It is ${now}.`,
    "",
    '1. Choose what I should do first, and in what order. Favour what has waited longest ("lastWorked"), what is already being worked on ("working": true), projects whose "everyDays" cadence says they are due, quick wins (a to-do or task with a short estimate like "(~15m)" in its text), and habits not logged today. What is already in "plan" is what I lined up myself: keep it near the top unless something else clearly matters more.',
    "2. List at most 12 things, from first to last. For each, give its id exactly as it appears below (a project, a to-do or a habit) and one short reason.",
    "",
    "Reply with ONLY a JSON object. No markdown fences, no commentary:",
    '{"order":[{"id":"<id>","why":"<short reason>"}]}',
    "",
    "What I can work on:",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}
