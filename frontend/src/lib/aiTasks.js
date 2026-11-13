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
  if (!text) throw new Error("Paste the AI's reply first.");
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const from = body.indexOf("{");
  const to = body.lastIndexOf("}");
  if (from < 0 || to <= from) throw new Error("Couldn't find any JSON in that reply.");
  try {
    return JSON.parse(body.slice(from, to + 1));
  } catch {
    throw new Error("That reply isn't valid JSON. Ask the AI to answer with only the JSON object.");
  }
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
  if (!Array.isArray(rows)) throw new Error('The JSON needs a "tasks" list.');
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
  if (matched === 0) throw new Error("None of the ids in that reply match your tasks. Copy the list again and ask the AI to keep the ids.");
  return changes;
}
