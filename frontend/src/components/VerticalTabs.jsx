/**
 * The tabs one under another, for when the side peek has left the page too little room for anything else: only
 * these are shown, and picking one is the way to bring the page back (the peek goes back to its usual width).
 * `tabs` is [{ id, label, icon, color }] like the tab bar's. A name needs about 8rem; narrower than that only the
 * icons show.
 */
export default function VerticalTabs({ tabs, value, onChange, label }) {
  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation="vertical"
      className="@container flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overflow-x-hidden px-1.5 py-3"
    >
      {tabs.map(({ id, label: text, icon: Icon, color }) => {
        const active = id === value;
        return (
          <button
            key={id}
            role="tab"
            id={`tab-${id}`}
            aria-selected={active}
            onClick={() => onChange(id)}
            title={text}
            className={`flex h-11 shrink-0 items-center justify-center gap-2 border border-l-4 px-1.5 text-left transition-colors @[8rem]:justify-start @[8rem]:px-3 ${
              active ? "border-line-strong bg-surface text-text" : "border-line bg-surface-2 text-muted hover:text-text"
            }`}
            style={{ borderLeftColor: color }}
          >
            {Icon && <Icon size={17} aria-hidden="true" className="shrink-0" />}
            <span className="font-hand hidden min-w-0 truncate text-[21px] leading-none @[8rem]:block">{text}</span>
            <span className="sr-only @[8rem]:hidden">{text}</span>
          </button>
        );
      })}
    </div>
  );
}
