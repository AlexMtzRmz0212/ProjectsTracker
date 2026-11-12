import { useLayoutEffect, useRef, useState } from "react";

/** A row of tabs: plain words with an ink underline on the open one. `tabs` is
 *  [{ id, label, icon?, count? }]; `right` is anything to sit at the far end.
 *  When the tabs don't fit the width they give way one at a time, so none is ever cut off and no room is wasted:
 *  the tab farthest from the open one drops its name first (keeping its icon), then the next farthest, and last
 *  the open one (`compact` asks for all of them at once). Tabs without an icon always keep their words. */
export default function TabBar({ tabs, value, onChange, label, right, bare, compact = false, className = "" }) {
  const bar = useRef(null);
  const list = useRef(null);
  const [width, setWidth] = useState(0);
  const [fonts, setFonts] = useState(0);
  const [step, setStep] = useState(0); // how many tabs have given up their name
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    // The names are set in a web font: once it arrives they are a different width
    const refit = () => setFonts((n) => n + 1);
    document.fonts?.addEventListener("loadingdone", refit);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", refit);
    };
  }, []);
  // Whatever changes what has to fit starts over from everything named; the next effect takes it in as far as needed
  const fitKey = tabs.map((t) => `${t.id}${t.count ?? ""}`).join(",") + value + compact + Boolean(right);
  useLayoutEffect(() => setStep(0), [width, fonts, fitKey]);
  useLayoutEffect(() => {
    const el = list.current;
    if (el && step < tabs.length && el.scrollWidth > el.clientWidth + 1) setStep(step + 1);
  });
  // The tabs farthest from the open one give up their names first; the open one is the last
  const openAt = tabs.findIndex((t) => t.id === value);
  const farthestFirst = tabs.map((_, i) => i).filter((i) => i !== openAt).sort((a, b) => Math.abs(b - openAt) - Math.abs(a - openAt) || b - a);
  const iconOnly = new Set(farthestFirst.slice(0, compact ? tabs.length : step));
  if (compact || step >= tabs.length) iconOnly.add(openAt);

  // Tabs that carry a `color` are index tabs of a notebook: the open one stands taller and takes the page's
  // paper, the others sit lower in a tint of their own color
  const folder = tabs.some((t) => t.color);
  return (
    <div ref={bar} className={`@container flex ${folder ? "items-end" : "items-center"} gap-4 ${bare ? "" : "border-b border-line"} ${className}`}>
      <div ref={list} role="tablist" aria-label={label} className={`flex min-w-0 overflow-x-clip ${folder ? "items-end gap-0.5 sm:gap-1" : "gap-1 sm:gap-3"}`}>
        {tabs.map(({ id, label: text, short, icon: Icon, count, color }) => {
          const active = id === value;
          const compact = Boolean(Icon) && iconOnly.has(tabs.findIndex((t) => t.id === id)); // this tab, icon only
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
              {Icon && <Icon size={compact ? 17 : 15} aria-hidden="true" className={`shrink-0 ${color && !compact ? "max-sm:hidden" : ""}`} />}
              {compact ? (
                <span className="sr-only">{text}</span>
              ) : short ? (
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
                title={compact ? text : undefined}
                className={`font-hand -mb-px inline-flex items-center gap-1.5 whitespace-nowrap rounded-t-lg border border-b-0 px-2 text-[21px] leading-none transition-[height,background-color,color] ${compact ? "sm:px-3" : "sm:px-4"} ${
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
