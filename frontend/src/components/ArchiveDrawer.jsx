import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { format, isThisYear } from "date-fns";
import { Archive, ArchiveRestore, ChevronUp, X } from "lucide-react";
import { iconFor, inkFor, inkText } from "../lib/palette";
import { fmtHM } from "../lib/time";
import { Button } from "./Modal";

/**
 * The archive, in a drawer that lives off the bottom edge of the screen: projects put away,
 * newest first. Its tab stays on screen, and the tab and the drawer are where a dragged card
 * is dropped (`data-drop="archive"`), shut or open. `dragging` is whether a card is in
 * someone's hand, `over` whether it is above the drawer. Each row opens the project and has
 * a Restore button, which sends it back to the column it left. Clicking the tab and Esc open
 * and shut it.
 */
export default function ArchiveDrawer({ projects, statusesById, dragging, over, onOpen, onRestore }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const count = `${projects.length} ${projects.length === 1 ? "project" : "projects"}`;
  const edge = over ? "border-text" : "border-line-strong";

  return createPortal(
    <section
      data-drop="archive"
      aria-label={`Archive, ${count}`}
      className={`fixed inset-x-0 bottom-[var(--bottom-bar,0px)] z-30 mx-auto w-[min(44rem,calc(100vw-2rem))] border-x border-t bg-surface transition-[transform,border-color] duration-200 ease-out ${edge}`}
      style={{ transform: open ? "translateY(0)" : "translateY(100%)" }}
    >
      {/* The tab stays on screen when the drawer is away, so there is always something to pull it up by, or drop on */}
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={open ? "Close the archive" : `Open the archive, ${count}`}
        title="Drag a project here to archive it"
        className={`absolute bottom-full left-1/2 flex -translate-x-1/2 items-center gap-1.5 border-x border-t transition-[height,padding,color,background-color,border-color] duration-150 ${edge} ${
          dragging ? "h-10 px-5" : "h-7 px-3"
        } ${over ? "bg-surface-2 text-text" : "bg-surface text-muted hover:text-text"}`}
      >
        <Archive size={14} aria-hidden="true" />
        {dragging ? (
          <span className="whitespace-nowrap font-serif text-xs italic">Drop to archive</span>
        ) : (
          <span className="figures text-xs">{projects.length}</span>
        )}
        <ChevronUp size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      <div className="flex items-center gap-2 border-b-[3px] border-double border-line-strong py-1.5 pl-3 pr-1.5">
        <Archive size={15} className="shrink-0 text-muted" aria-hidden="true" />
        <h2 className="font-serif text-[15px] font-semibold">Archive</h2>
        <span className="figures text-xs text-muted">{projects.length}</span>
        <button
          onClick={() => setOpen(false)}
          className="ml-auto grid size-8 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      <ul id={`${id}-list`} inert={!open} className="max-h-[min(18rem,45dvh)] overflow-y-auto">
        {projects.map((p) => {
          const Icon = iconFor(p.icon);
          const status = statusesById.get(p.status_id);
          const archivedAt = new Date(p.archived_at);
          return (
            <li key={p.id} className="flex items-center gap-3 border-b border-rule px-3 py-1.5 last:border-b-0">
              <Icon size={15} strokeWidth={2.25} className="shrink-0" style={{ color: inkText(p.color) }} aria-hidden="true" />
              <button
                onClick={() => onOpen(p.id)}
                title={p.name}
                aria-label={`Open ${p.name}: notes, to-dos and sessions`}
                className="min-w-0 flex-1 truncate text-left font-serif text-[14px] underline-offset-4 hover:underline focus-visible:underline"
              >
                {p.name}
              </button>
              {status && (
                <span className="hidden shrink-0 items-center gap-1.5 text-xs text-muted sm:inline-flex">
                  <span className="size-2" style={{ background: inkFor(status.color) }} aria-hidden="true" />
                  {status.name}
                </span>
              )}
              <span className="figures hidden shrink-0 text-xs text-muted sm:inline">{fmtHM(p.total_seconds)}</span>
              <span className="shrink-0 font-serif text-xs italic text-faint max-sm:hidden">
                {format(archivedAt, isThisYear(archivedAt) ? "MMM d" : "MMM d, yyyy")}
              </span>
              <Button variant="ghost" className="h-7 shrink-0 px-2 text-xs" onClick={() => onRestore(p.id)} aria-label={`Restore ${p.name}`}>
                <ArchiveRestore size={14} aria-hidden="true" /> Restore
              </Button>
            </li>
          );
        })}
        {projects.length === 0 && (
          <li className="px-3 py-4 text-center text-[13px] text-faint">Drag a project here to archive it</li>
        )}
      </ul>
    </section>,
    document.body,
  );
}
