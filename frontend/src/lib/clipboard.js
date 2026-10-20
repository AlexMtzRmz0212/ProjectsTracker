/** Put `text` on the clipboard. Resolves to whether it worked. Falls back to a hidden textarea where the
 *  async clipboard isn't available (an insecure origin, an older browser). */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fall through to the textarea
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** A to-do and its sub-to-dos as plain text: `- [ ] text` (or `[x]` when done), subs indented. */
export function todoAsText(todo, subs = []) {
  const box = (t) => (t.cancelled_at ? "[-]" : t.done ? "[x]" : "[ ]");
  return [`- ${box(todo)} ${todo.text}`, ...subs.map((s) => `  - ${box(s)} ${s.text}`)].join("\n");
}
