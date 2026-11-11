import { useState } from "react";
import { ArrowRight, Check, X } from "lucide-react";
import { planChanges } from "../lib/aiTasks";

/**
 * Where an AI's reply to "Copy for AI" is pasted. It is read, shown as the changes it would make (new text with
 * the estimate, sub-tasks to add) and only applied when you press Apply. Nothing is ever removed.
 * `tasks` are the open tasks, `subsOf(task)` a task's sub-tasks.
 */
export default function TaskAiPanel({ tasks, subsOf, todoOps, onClose }) {
  const [raw, setRaw] = useState("");
  const [changes, setChanges] = useState(null);
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);

  const preview = () => {
    try {
      setChanges(planChanges(raw, tasks, subsOf));
      setError("");
    } catch (e) {
      setChanges(null);
      setError(e.message);
    }
  };

  const apply = async () => {
    setApplying(true);
    // One at a time, so the sub-tasks keep the AI's order
    for (const { task, text, addSubs } of changes) {
      if (text) await todoOps.update(task.id, { text });
      for (const sub of addSubs) await todoOps.add(null, sub, task.id);
    }
    setApplying(false);
    onClose();
  };

  const subCount = changes?.reduce((n, c) => n + c.addSubs.length, 0) ?? 0;

  return (
    <section className="mb-3 shrink-0 border border-line-strong bg-surface p-3" aria-label="Paste the AI's reply">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 font-serif text-[15px] font-semibold">Paste the AI's reply</h3>
        <button
          onClick={onClose}
          aria-label="Close"
          title="Close"
          className="grid size-7 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <X size={15} />
        </button>
      </div>
      <p className="mt-0.5 text-[13px] text-muted">
        Use <b>Copy for AI</b>, paste it into any chat, then paste the JSON it answers with here. You see the changes
        before anything is saved, and nothing is removed.
      </p>
      <textarea
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          setChanges(null);
          setError("");
        }}
        rows={5}
        spellCheck={false}
        placeholder='{"tasks":[{"id":"…","text":"Write report (~45m)","subtasks":["Outline","Draft"]}]}'
        aria-label="The AI's reply"
        className="figures mt-2 w-full resize-y border border-line-strong bg-transparent p-2.5 text-[12px] leading-relaxed outline-none transition-colors placeholder:text-faint focus:border-text"
      />
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {error}
        </p>
      )}

      {changes && (
        <div className="mt-3">
          {changes.length === 0 ? (
            <p className="text-[13px] text-muted">Nothing to change: the reply matches what you already have.</p>
          ) : (
            <ul className="max-h-72 divide-y divide-rule overflow-y-auto border-y border-rule">
              {changes.map(({ task, text, addSubs }) => (
                <li key={task.id} className="py-2 text-[13px]">
                  {text ? (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-muted line-through">{task.text}</span>
                      <ArrowRight size={12} className="shrink-0 text-faint" aria-hidden="true" />
                      <span className="font-semibold">{text}</span>
                    </div>
                  ) : (
                    <div className="font-semibold">{task.text}</div>
                  )}
                  {addSubs.length > 0 && (
                    <ul className="mt-1 pl-4 text-muted">
                      {addSubs.map((s) => (
                        <li key={s}>+ {s}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        {changes && changes.length > 0 ? (
          <button
            onClick={apply}
            disabled={applying}
            className="inline-flex h-8 items-center gap-1.5 border border-text bg-text px-3 text-xs font-semibold text-bg transition-opacity disabled:opacity-50"
          >
            <Check size={13} aria-hidden="true" />
            Apply {changes.length} {changes.length === 1 ? "task" : "tasks"}
            {subCount > 0 && `, ${subCount} sub-${subCount === 1 ? "task" : "tasks"}`}
          </button>
        ) : (
          <button
            onClick={preview}
            disabled={!raw.trim()}
            className="inline-flex h-8 items-center border border-line-strong px-3 text-xs font-semibold transition-colors hover:border-text hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40"
          >
            Preview changes
          </button>
        )}
        {changes && changes.length > 0 && (
          <button onClick={() => setChanges(null)} className="h-8 px-2 text-xs text-muted transition-colors hover:text-text">
            Back
          </button>
        )}
      </div>
    </section>
  );
}
