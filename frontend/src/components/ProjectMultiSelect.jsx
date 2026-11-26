import { useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { useClickOutside } from "../hooks/useClickOutside";
import { iconFor, inkText } from "../lib/palette";
import { matchProjects } from "./ProjectSearch";
import { __, _n } from "../i18n";

/**
 * Pick any number of projects from one button: it says what is picked ("All projects", a project's name, or "3 projects"),
 * and opens a searchable checklist. `selected` is a Set of project ids (empty means all) and `onChange(set)` takes the new one.
 */
export default function ProjectMultiSelect({ projects, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef(null);
  useClickOutside(root, open, () => setOpen(false));

  const shown = useMemo(() => matchProjects(projects, query), [projects, query]);
  const picked = projects.filter((p) => selected.has(p.id));
  const toggle = (id) => {
    const next = new Set(selected);
    if (!next.delete(id)) next.add(id);
    onChange(next);
  };
  const label = picked.length === 0 ? __("All projects") : picked.length === 1 ? picked[0].name : _n(picked.length, "{n} project", "{n} projects");

  return (
    <div
      ref={root}
      className="relative inline-block"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.stopPropagation();
        setOpen(false);
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={__("Filter by project")}
        className="inline-flex h-8 max-w-[16rem] items-center gap-2 border border-line-strong px-2.5 text-[13px] font-semibold transition-colors hover:border-text hover:bg-surface-2"
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={13} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] border border-line-strong bg-surface shadow-[0_6px_24px_rgb(0_0_0/0.25)]">
          <label className="flex h-9 items-center gap-2 border-b border-line-strong px-2.5 focus-within:border-text">
            <Search size={14} className="shrink-0 text-muted" aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={__("Search projects")}
              aria-label={__("Search projects")}
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
            />
          </label>
          <ul role="listbox" aria-multiselectable="true" aria-label={__("Projects")} className="max-h-64 overflow-y-auto py-1">
            <li>
              <button
                type="button"
                role="option"
                aria-selected={picked.length === 0}
                onClick={() => onChange(new Set())}
                className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-[13px] font-semibold transition-colors hover:bg-surface-2"
              >
                <span className="grid size-4 shrink-0 place-items-center">{picked.length === 0 && <Check size={14} aria-hidden="true" />}</span>
                {__("All projects")}
              </button>
            </li>
            {shown.map((p) => {
              const Icon = iconFor(p.icon);
              const on = selected.has(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => toggle(p.id)}
                    className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-[13px] transition-colors hover:bg-surface-2"
                  >
                    <span className="grid size-4 shrink-0 place-items-center border border-line-strong">{on && <Check size={12} aria-hidden="true" />}</span>
                    <Icon size={13} style={{ color: inkText(p.color) }} className="shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  </button>
                </li>
              );
            })}
            {shown.length === 0 && <li className="px-2.5 py-3 font-serif text-xs italic text-muted">{__("Nothing matches “{query}”.", { query: query.trim() })}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
