import { useEffect, useState } from "react";
import { Check, Flag, GripVertical, Pin, Plus, Trash2 } from "lucide-react";
import Modal, { Button } from "./Modal";
import { ON_INK, PROJECT_COLORS, inkFor } from "../lib/palette";
import { useReorder } from "../hooks/useReorder";

/** Edit the list of statuses projects can have. Changes save as you make them;
 *  there is no Save button. */
export default function StatusModal({ projects, statuses, ops, onClose }) {
  const [pickingFor, setPickingFor] = useState(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const openCount = statuses.filter((s) => !s.is_done).length;
  const usedBy = (id) => projects.filter((p) => p.status_id === id).length;
  const lastOpen = "Keep at least one status that isn't finished.";

  const reorder = useReorder(statuses.map((s) => s.id), ops.reorder);

  const add = async (e) => {
    e.preventDefault();
    const name = draft.trim();
    if (!name || adding) return;
    setAdding(true);
    // A new status takes the first ink nobody is using yet
    const color =
      PROJECT_COLORS.find((c) => !statuses.some((s) => inkFor(s.color) === c)) ??
      PROJECT_COLORS[statuses.length % PROJECT_COLORS.length];
    const ok = await ops.create({ name, color });
    setAdding(false);
    if (ok) setDraft("");
  };

  return (
    <Modal
      title="Statuses"
      onClose={onClose}
      footer={
        <Button variant="primary" className="ml-auto" onClick={onClose}>
          <Check size={16} /> Done
        </Button>
      }
    >
      <p className="text-xs text-muted">
        Where a project stands. The project list is grouped by these, in this order: drag a handle to rearrange them.
        Flag the ones that mean it's over: those projects lose their timer and fold away. Pin one to keep its column on
        the board when you Hide all.
      </p>

      <ul className={`mt-3 border-t border-rule ${reorder.held ? "select-none" : ""}`}>
        {statuses.map((item, i) => {
          const used = usedBy(item.id);
          const sortRow = reorder.rowProps(i);
          const finishBlock = !item.is_done && openCount === 1 ? lastOpen : null;
          const deleteBlock = used
            ? `${used} ${used === 1 ? "project uses" : "projects use"} this status. Move ${used === 1 ? "it" : "them"} first.`
            : finishBlock;
          return (
            <li
              key={item.id}
              {...sortRow}
              className={`border-b border-rule ${sortRow.className ?? "bg-surface"}`}
            >
              <div className="flex items-center gap-1.5 py-1">
                <button
                  {...reorder.gripProps(item.id, i)}
                  aria-label={`Move ${item.name}: drag, or use the up and down arrow keys`}
                  title="Drag to reorder"
                  className={`-ml-1 grid h-8 w-5 shrink-0 touch-none place-items-center text-faint transition-colors hover:text-text ${
                    reorder.held === item.id ? "cursor-grabbing text-text" : "cursor-grab"
                  }`}
                >
                  <GripVertical size={15} />
                </button>
                <button
                  onClick={() => setPickingFor(pickingFor === item.id ? null : item.id)}
                  className="grid size-8 shrink-0 place-items-center transition-colors hover:bg-surface-2"
                  aria-label={`Color of ${item.name}`}
                  aria-expanded={pickingFor === item.id}
                >
                  <span className="size-4" style={{ background: inkFor(item.color) }} />
                </button>

                <NameInput value={item.name} onCommit={(name) => ops.update(item.id, { name })} />

                <button
                  onClick={() => ops.update(item.id, { is_done: !item.is_done })}
                  disabled={Boolean(finishBlock)}
                  aria-pressed={item.is_done}
                  aria-label={`Mark ${item.name} as finished`}
                  title={
                    finishBlock ??
                    (item.is_done
                      ? "Finished: projects here have no timer and are folded away. Click to undo"
                      : "Flag as finished: projects here lose their timer and fold away")
                  }
                  className={`grid size-8 shrink-0 place-items-center transition-colors enabled:hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-30 ${
                    item.is_done ? "text-text" : "text-faint enabled:hover:text-text"
                  }`}
                >
                  <Flag size={14} fill={item.is_done ? "currentColor" : "none"} />
                </button>

                <button
                  onClick={() => ops.update(item.id, { is_pinned: !item.is_pinned })}
                  aria-pressed={Boolean(item.is_pinned)}
                  aria-label={`Keep ${item.name} on the board when hiding all columns`}
                  title={
                    item.is_pinned
                      ? "Stays on the board when you Hide all. Click to unpin"
                      : "Pin: keep this column on the board when you Hide all"
                  }
                  className={`grid size-8 shrink-0 place-items-center transition-colors hover:bg-surface-2 ${
                    item.is_pinned ? "text-text" : "text-faint hover:text-text"
                  }`}
                >
                  <Pin size={14} fill={item.is_pinned ? "currentColor" : "none"} />
                </button>

                <span className="figures w-6 shrink-0 text-right text-xs text-faint" title={`${used} in use`}>
                  {used}
                </span>

                <IconButton
                  label={`Delete ${item.name}`}
                  title={deleteBlock ?? `Delete ${item.name}`}
                  disabled={Boolean(deleteBlock)}
                  danger
                  onClick={() => ops.remove(item.id)}
                >
                  <Trash2 size={15} />
                </IconButton>
              </div>

              {pickingFor === item.id && (
                <div className="flex flex-wrap gap-2 pb-3 pl-1.5">
                  {PROJECT_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => {
                        ops.update(item.id, { color: c });
                        setPickingFor(null);
                      }}
                      aria-label={`Color ${c}`}
                      aria-pressed={c === inkFor(item.color)}
                      className="grid size-7 place-items-center transition-transform hover:scale-110"
                      style={{ background: c, color: ON_INK }}
                    >
                      {c === inkFor(item.color) && <Check size={14} strokeWidth={3} />}
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <form onSubmit={add} className="mt-2 flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={40}
          placeholder="New status"
          aria-label="New status name"
          className="h-9 min-w-0 flex-1 border-b border-line-strong bg-transparent px-1.5 text-[13px] outline-none placeholder:text-faint focus:border-text"
        />
        <Button type="submit" variant="outline" disabled={!draft.trim() || adding}>
          <Plus size={15} /> Add
        </Button>
      </form>
    </Modal>
  );
}

/** Edits in place and saves when you leave the field or press Enter. A name the server
 *  refuses (an empty one, or a duplicate) goes back to what it was. */
function NameInput({ value, onCommit }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = async () => {
    const name = draft.trim();
    if (!name || name === value) return setDraft(value);
    if (!(await onCommit(name))) setDraft(value);
  };

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      maxLength={40}
      aria-label="Status name"
      className="h-8 min-w-0 flex-1 bg-transparent px-1.5 text-[13px] outline-none focus:bg-surface-2"
    />
  );
}

function IconButton({ label, title, danger, ...props }) {
  return (
    <button
      aria-label={label}
      title={title ?? label}
      className={`grid size-8 shrink-0 place-items-center text-muted transition-colors enabled:hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-30 ${
        danger ? "enabled:hover:text-danger" : "enabled:hover:text-text"
      }`}
      {...props}
    />
  );
}
