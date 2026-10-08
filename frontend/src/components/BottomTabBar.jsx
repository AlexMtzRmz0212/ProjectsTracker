/** The phone's tab bar: the same sections as the top TabBar, along the bottom edge where a thumb
 *  reaches them, padded clear of the home indicator. `tabs` is [{ id, label, icon }]. The top bar
 *  is hidden on phones whenever this one is shown. */
export default function BottomTabBar({ tabs, value, onChange, label }) {
  return (
    <nav
      aria-label={label}
      className="relative z-[31] shrink-0 border-t-[3px] border-double border-line-strong bg-bg pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map(({ id, label: text, icon: Icon }) => {
          const active = id === value;
          return (
            <li key={id}>
              <button
                onClick={() => onChange(id)}
                aria-current={active ? "page" : undefined}
                className={`flex h-16 w-full flex-col items-center justify-center gap-1 border-t-2 text-[11px] font-semibold transition-colors ${
                  active ? "border-text text-text" : "border-transparent text-muted hover:text-text"
                }`}
              >
                {Icon && <Icon size={20} aria-hidden="true" />}
                {text}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
