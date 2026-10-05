import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import Modal from "./Modal";
import { ON_INK, inkFor, iconFor } from "../lib/palette";

/** The projects whose name holds every word typed, best first: names that start with the
 *  query, then ones with a word that does, then the rest. Live projects come before archived
 *  ones, and ties keep the order given. An empty query lists everything. */
export function matchProjects(projects, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const rank = (p) => {
    const name = p.name.toLowerCase();
    if (!words.every((w) => name.includes(w))) return null;
    if (words.length === 0 || name.startsWith(words[0])) return 0;
    return name.split(/\s+/).some((part) => part.startsWith(words[0])) ? 1 : 2;
  };
  return projects
    .map((project) => ({ project, rank: rank(project) }))
    .filter((x) => x.rank !== null)
    .sort((a, b) => Boolean(a.project.archived_at) - Boolean(b.project.archived_at) || a.rank - b.rank)
    .map((x) => x.project);
}

/** Find a project by name: type, move with the arrow keys, Enter (or a click) opens it. */
export default function ProjectSearch({ projects, statusesById, onPick, onClose }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const results = useMemo(() => matchProjects(projects, query), [projects, query]);
  const current = Math.min(active, results.length - 1);

  useEffect(() => {
    listRef.current?.children[current]?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length) setActive((current + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[current]) onPick(results[current].id);
    }
  };

  return (
    <Modal title="Find a project" onClose={onClose}>
      <div className="flex items-center gap-2 border-b border-line-strong focus-within:border-text">
        <Search size={15} className="shrink-0 text-muted" aria-hidden="true" />
        <input
          id="project-search"
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls="project-search-results"
          aria-activedescendant={results[current] ? `project-search-${results[current].id}` : undefined}
          aria-label="Project name"
          placeholder="Type a project name and press Enter"
          autoComplete="off"
          spellCheck={false}
          className="h-10 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
        />
      </div>

      {results.length === 0 ? (
        <p className="py-6 text-center font-serif text-sm italic text-muted">No project matches “{query.trim()}”.</p>
      ) : (
        <ul id="project-search-results" ref={listRef} role="listbox" className="mt-1 max-h-[22rem] overflow-y-auto">
          {results.map((p, i) => {
            const Icon = iconFor(p.icon);
            const status = statusesById.get(p.status_id);
            return (
              <li
                key={p.id}
                id={`project-search-${p.id}`}
                role="option"
                aria-selected={i === current}
                onClick={() => onPick(p.id)}
                onMouseMove={() => i !== current && setActive(i)}
                className={`flex cursor-pointer items-center gap-3 border-b border-rule px-1 py-2 ${i === current ? "bg-surface-2" : ""}`}
              >
                <span className="grid size-7 shrink-0 place-items-center" style={{ background: p.color, color: ON_INK }}>
                  <Icon size={15} />
                </span>
                <span className="min-w-0 flex-1 truncate font-serif text-[15px] font-medium">{p.name}</span>
                {p.archived_at ? (
                  <span className="shrink-0 font-serif text-xs italic text-muted">Archived</span>
                ) : (
                  status && (
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted">
                      <span className="size-2" style={{ background: inkFor(status.color) }} aria-hidden="true" />
                      {status.name}
                    </span>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
