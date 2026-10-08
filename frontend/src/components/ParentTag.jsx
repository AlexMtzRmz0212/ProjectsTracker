import { CornerDownRight } from "lucide-react";

/** A small tag naming the to-do a sub-to-do belongs to, so it reads on its own in a list of
 *  ticked-off to-dos. `todosById` is a Map of every to-do; nothing is drawn for a to-do that
 *  isn't a sub-to-do (or whose parent is gone). */
export default function ParentTag({ todo, todosById, className = "" }) {
  const parent = todo.parent_id ? todosById.get(todo.parent_id) : null;
  if (!parent) return null;
  return (
    <span
      className={`inline-flex min-w-0 max-w-[12rem] shrink items-center gap-1 border border-line px-1.5 text-[11px] leading-5 text-muted ${className}`}
      title={`Under "${parent.text}"`}
    >
      <CornerDownRight size={10} className="shrink-0" aria-hidden="true" />
      <span className="truncate">{parent.text}</span>
    </span>
  );
}
