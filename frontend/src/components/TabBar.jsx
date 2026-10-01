/** A row of tabs: plain words with an ink underline on the open one. `tabs` is
 *  [{ id, label, icon?, count? }]; `right` is anything to sit at the far end. */
export default function TabBar({ tabs, value, onChange, label, right, bare, className = "" }) {
  return (
    <div className={`flex items-center gap-4 ${bare ? "" : "border-b border-line"} ${className}`}>
      <div role="tablist" aria-label={label} className="flex min-w-0 gap-1 sm:gap-3">
        {tabs.map(({ id, label: text, short, icon: Icon, count }) => {
          const active = id === value;
          return (
            <button
              key={id}
              role="tab"
              id={`tab-${id}`}
              aria-selected={active}
              aria-controls={`panel-${id}`}
              onClick={() => onChange(id)}
              className={`-mb-px inline-flex h-11 items-center gap-2 whitespace-nowrap border-b-2 px-2 text-[13px] font-semibold transition-colors sm:px-3 ${
                active ? "border-text text-text" : "border-transparent text-muted hover:text-text"
              }`}
            >
              {Icon && <Icon size={15} aria-hidden="true" className="shrink-0" />}
              {short ? (
                <>
                  <span className="sm:hidden">{short}</span>
                  <span className="max-sm:hidden">{text}</span>
                </>
              ) : (
                text
              )}
              {count !== undefined && <span className="figures text-xs font-normal text-muted">{count}</span>}
            </button>
          );
        })}
      </div>
      {right && <div className="ml-auto flex min-w-0 items-center gap-3">{right}</div>}
    </div>
  );
}
