/** A row of tabs: plain words with an ink underline on the open one. `tabs` is
 *  [{ id, label, icon?, count? }]; `right` is anything to sit at the far end. */
export default function TabBar({ tabs, value, onChange, label, right, bare, className = "" }) {
  // Tabs that carry a `color` are index tabs of a notebook: the open one stands taller and takes the page's
  // paper, the others sit lower in a tint of their own color
  const folder = tabs.some((t) => t.color);
  return (
    <div className={`flex ${folder ? "items-end" : "items-center"} gap-4 ${bare ? "" : "border-b border-line"} ${className}`}>
      <div role="tablist" aria-label={label} className={`flex min-w-0 ${folder ? "items-end gap-0.5 sm:gap-1" : "gap-1 sm:gap-3"}`}>
        {tabs.map(({ id, label: text, short, icon: Icon, count, color }) => {
          const active = id === value;
          const common = {
            key: id,
            role: "tab",
            id: `tab-${id}`,
            "aria-selected": active,
            "aria-controls": `panel-${id}`,
            onClick: () => onChange(id),
          };
          const inner = (
            <>
              {Icon && <Icon size={15} aria-hidden="true" className={`shrink-0 ${color ? "max-sm:hidden" : ""}`} />}
              {short ? (
                <>
                  <span className="sm:hidden">{short}</span>
                  <span className="max-sm:hidden">{text}</span>
                </>
              ) : (
                text
              )}
              {count !== undefined && <span className="figures text-xs font-normal text-muted">{count}</span>}
            </>
          );
          if (color) {
            return (
              <button
                {...common}
                className={`font-hand -mb-px inline-flex items-center gap-1.5 whitespace-nowrap rounded-t-lg border border-b-0 px-2 text-[21px] leading-none transition-[height,background-color,color] sm:px-4 ${
                  active ? "h-11 border-line-strong bg-bg font-semibold text-text" : "h-9 border-line text-muted hover:h-10 hover:text-text"
                }`}
                style={{
                  boxShadow: `inset 0 ${active ? 4 : 3}px 0 ${color}`,
                  backgroundColor: active ? undefined : `color-mix(in srgb, ${color} 16%, var(--surface-2))`,
                }}
              >
                {inner}
              </button>
            );
          }
          return (
            <button
              {...common}
              className={`-mb-px inline-flex h-11 items-center gap-2 whitespace-nowrap border-b-2 px-2 text-[13px] font-semibold transition-colors sm:px-3 ${
                active ? "border-text text-text" : "border-transparent text-muted hover:text-text"
              }`}
            >
              {inner}
            </button>
          );
        })}
      </div>
      {right && <div className={`ml-auto flex min-w-0 items-center gap-3 ${folder ? "self-center" : ""}`}>{right}</div>}
    </div>
  );
}
