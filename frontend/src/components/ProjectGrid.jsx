import { useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import ProjectCard from "./ProjectCard";
import { fmtHM } from "../lib/time";

/** The projects ledger: one ruled row per project, closed with a totals line. */
export default function ProjectGrid({ projects, cardProps, onCreate }) {
  const [showDone, setShowDone] = useState(false);
  const active = projects.filter((p) => p.status === "active");
  const done = projects.filter((p) => p.status === "done");
  const rows = active.map((p) => [p, cardProps(p)]);
  const todayTotal = rows.reduce((sum, [, c]) => sum + c.todaySeconds, 0);
  const grandTotal = rows.reduce((sum, [, c]) => sum + c.totalSeconds, 0);

  return (
    <section className="py-5 lg:pr-6">
      <div className="mb-2 flex items-baseline gap-2 pl-11">
        <h2 className="font-serif text-[17px] font-semibold">Projects</h2>
        {projects.length > 0 && <span className="font-serif text-xs italic text-muted">{active.length} active</span>}
      </div>

      {projects.length === 0 ? (
        <EmptyLedger onCreate={onCreate} />
      ) : (
        <>
          <div className="ledger-row border-t border-rule max-sm:hidden" aria-hidden="true">
            <span className="ledger-margin" />
            <ColumnHead className="ledger-name">Project</ColumnHead>
            <ColumnHead className="ledger-today">Today</ColumnHead>
            <ColumnHead className="ledger-week">Last 7 days</ColumnHead>
            <ColumnHead className="ledger-total">Total</ColumnHead>
          </div>

          <ul className="max-sm:border-t max-sm:border-rule">
            {rows.map(([p, props]) => (
              <ProjectCard key={p.id} project={p} {...props} />
            ))}
          </ul>

          {rows.length > 0 && (
            <div className="ledger-row border-b-0">
              <span className="ledger-margin" />
              <span className="ledger-name font-serif text-xs italic text-muted">Total</span>
              <div className="ledger-figs">
                <span className="ledger-today">
                  <span className="font-serif text-xs italic text-muted sm:sr-only">Today </span>
                  <span className="figures double-rule font-semibold">{fmtHM(todayTotal)}</span>
                </span>
                <span className="ledger-total">
                  <span className="font-serif text-xs italic text-muted sm:sr-only">Total </span>
                  <span className="figures double-rule font-semibold">{fmtHM(grandTotal)}</span>
                </span>
              </div>
            </div>
          )}

          <button onClick={onCreate} className="ledger-row group w-full border-b-0 text-left">
            <span className="ledger-margin" />
            <span className="ledger-name gap-2 text-[13px] text-muted transition-colors group-hover:text-text">
              <Plus size={15} /> New project
            </span>
          </button>

          {done.length > 0 && (
            <div className="mt-2 pl-11">
              <button
                onClick={() => setShowDone((s) => !s)}
                className="flex items-center gap-1.5 py-1 text-[13px] text-muted transition-colors hover:text-text"
                aria-expanded={showDone}
              >
                <ChevronDown size={15} className={`transition-transform ${showDone ? "" : "-rotate-90"}`} />
                Done
                <span className="figures text-xs">({done.length})</span>
              </button>
            </div>
          )}
          {showDone && done.length > 0 && (
            <ul className="mt-1 border-t border-rule">
              {done.map((p) => (
                <ProjectCard key={p.id} project={p} {...cardProps(p)} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function ColumnHead({ className, children }) {
  return <span className={`${className} font-serif text-xs italic text-muted`}>{children}</span>;
}

/** A blank ruled page with the first line waiting to be filled in. */
function EmptyLedger({ onCreate }) {
  return (
    <div className="border-t border-rule">
      <div className="ledger-row">
        <span className="ledger-margin" />
        <div className="ledger-name py-2">
          <button
            onClick={onCreate}
            className="inline-flex h-9 items-center gap-2 bg-text px-3.5 text-[13px] font-semibold text-bg transition-opacity hover:opacity-90"
          >
            <Plus size={16} strokeWidth={2.5} /> Create your first project
          </button>
        </div>
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="ledger-row" aria-hidden="true">
          <span className="ledger-margin" />
          <span className="ledger-name" />
        </div>
      ))}
    </div>
  );
}
