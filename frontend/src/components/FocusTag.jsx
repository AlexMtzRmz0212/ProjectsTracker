import { useLayoutEffect, useRef, useState } from "react";
import { Check, Tag, X } from "lucide-react";
import { useClickOutside } from "../hooks/useClickOutside";
import { iconFor, inkText } from "../lib/palette";

const WIDTH = 288; // px
const EDGE = 8;

/**
 * Says what a pomodoro is for: a project or task from `choices` (the open ones, [{ id, name, color, icon }], a task's
 * id being its key), or a few words of your own for a chore or activity that has no project. A project or task
 * stays for the set; a chore is only for that focus (the pomodoro hook drops it when the focus is over). It is saved
 * with the pomodoro, so the calendar can name it. `value` is { project_id, todo_id, label } or null; `onChange` gets
 * the same, or null to clear it. `children(open, toggle)` draws the button that opens it, so it can sit in the
 * header chip or on the full screen. Esc, a press outside, or a pick closes it.
 */
export default function FocusTag({ value, onChange, choices, up = false, children }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState(null);
  const root = useRef(null);
  const trigger = useRef(null);

  useClickOutside(root, open, () => setOpen(false));

  useLayoutEffect(() => {
    if (!open) return;
    const rect = trigger.current.getBoundingClientRect();
    const left = Math.max(EDGE, Math.min(window.innerWidth - WIDTH - EDGE, rect.left + rect.width / 2 - WIDTH / 2));
    setPlace(up ? { left, bottom: window.innerHeight - rect.top + 6 } : { left, top: rect.bottom + 6 });
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [open, up]);

  return (
    <span ref={root} className="relative inline-flex">
      <span ref={trigger} className="inline-flex">
        {children(open, () => setOpen((o) => !o))}
      </span>
      {open && place && (
        <div
          role="dialog"
          aria-label="What is this pomodoro for?"
          className="fade-in fixed z-[60] border border-line-strong bg-surface p-2"
          style={{ width: WIDTH, ...place }}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            setOpen(false);
          }}
        >
          <FocusPicker value={value} onChange={onChange} choices={choices} onDone={() => setOpen(false)} />
        </div>
      )}
    </span>
  );
}

/**
 * The picker itself, without a window of its own: the box to type in, the matching projects and tasks, the
 * chore, and the way to clear it. FocusTag puts it in a popover; the mini clock puts it over the clock.
 * `onDone` is called after a pick.
 */
export function FocusPicker({ value, onChange, choices, onDone }) {
  const [text, setText] = useState("");

  const q = text.trim().toLowerCase();
  const matches = (choices ?? []).filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, 6);
  const exact = matches.find((m) => m.name.toLowerCase() === q);

  const pick = (next) => {
    onChange(next);
    setText("");
    onDone?.();
  };
  const pickChoice = (c) => pick({ project_id: c.id, todo_id: null, label: c.name });
  const pickChore = () => pick({ project_id: null, todo_id: null, label: text.trim().slice(0, 120) });

  const row = "flex h-9 w-full items-center gap-2 px-2 text-left text-[13px] transition-colors hover:bg-surface-2";

  return (
    <>
      <p className="mb-1.5 px-1 text-xs font-semibold text-muted">What is this pomodoro for?</p>
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || !text.trim()) return;
          e.preventDefault();
          // A project or task named exactly like what was typed, else what was typed becomes a chore
          if (exact) pickChoice(exact);
          else pickChore();
        }}
        maxLength={120}
        placeholder="A project, a task, or any chore"
        aria-label="What is this pomodoro for?"
        className="h-9 w-full border border-line-strong bg-transparent px-2 text-[13px] outline-none focus:border-text"
      />
      <ul className="mt-1.5 max-h-60 overflow-y-auto">
        {matches.map((c) => {
          const Icon = iconFor(c.icon);
          return (
            <li key={c.id}>
              <button onClick={() => pickChoice(c)} className={row}>
                <Icon size={14} className="shrink-0" style={{ color: inkText(c.color) }} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {value?.project_id === c.id && <Check size={13} aria-hidden="true" />}
              </button>
            </li>
          );
        })}
        {text.trim() && !exact && (
          <li>
            <button onClick={pickChore} className={row}>
              <Tag size={14} className="shrink-0 text-muted" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">
                Use "<b>{text.trim()}</b>" as a chore
              </span>
            </button>
          </li>
        )}
      </ul>
      <p className="mt-1.5 px-1 font-serif text-xs italic text-faint">A chore is only for this focus; a project or task stays for the set.</p>
      {value && (
        <button
          onClick={() => pick(null)}
          className="mt-1 flex h-8 w-full items-center gap-2 border-t border-rule px-1 text-left text-xs text-muted transition-colors hover:text-text"
        >
          <X size={13} aria-hidden="true" /> Clear: follow the project being timed
        </button>
      )}
    </>
  );
}
