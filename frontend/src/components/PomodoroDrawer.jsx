import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Minus, Plus, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { DEFAULTS, LIMITS } from "../hooks/usePomodoro";
import { useEdgeDrag } from "../hooks/useEdgeDrag";

const WIDTH = 640; // px, at most
const MARGIN = 12; // px kept clear of the window's sides

/**
 * Pomodoro settings in a top peek: a panel that lives off the top edge of the window. Its tab (a short
 * bar until pointed at) hangs from that edge right above the pomodoro (the element marked data-pomodoro-anchor: the chip in the app
 * header, or with `anchor` "screen" the full screen's countdown), so it reads as part of the timer. It
 * is the only way to the settings.
 * Click the tab, or drag it down, to bring the panel down centred over the pomodoro; click it, drag it
 * (or the title) back up, or press ✕ or Esc to put it away.
 */
export default function PomodoroDrawer({ open, onOpenChange, anchor = "header", settings, onChange, onReset }) {
  const panel = useRef(null);
  const slide = useEdgeDrag(panel, open, onOpenChange, "top");
  const place = useAnchor(anchor);
  const shown = open || slide.offset !== null; // the tab at full size, not the short bar it rests as

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onOpenChange(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  return (
    <aside
      ref={panel}
      aria-label="Pomodoro settings"
      className="fixed top-0 z-[46] flex max-h-[calc(100dvh-1.5rem)] flex-col border-x border-b border-line-strong bg-surface transition-transform duration-200 ease-out"
      style={{ left: place.left, width: place.width, ...slide.style }}
    >
      {/* The tab stays on screen when the panel is away, hanging from the top edge over the pomodoro. At rest
          it is only a short bar, to keep the gap above the chip quiet; pointed at, focused, pulled or open,
          it grows into the full tab. The button itself is the larger, invisible area around it. */}
      <button
        {...slide.handlers}
        onClick={() => !slide.wasDrag() && onOpenChange(!open)}
        className="group absolute top-full flex h-3 w-14 -translate-x-1/2 cursor-grab touch-none justify-center active:cursor-grabbing sm:h-3.5"
        style={{ left: place.tabX }}
        aria-label={open ? "Close pomodoro settings" : "Pomodoro settings"}
        aria-expanded={open}
        title={open ? "Close pomodoro settings" : "Pomodoro settings (click, or pull down)"}
      >
        <span
          className={`flex items-center justify-center gap-1 overflow-hidden border-x border-b transition-all duration-150 ${
            shown
              ? "h-full w-full border-line-strong bg-surface-2 text-text"
              : "h-1 w-7 border-transparent bg-line-strong text-muted group-hover:h-full group-hover:w-full group-hover:border-line-strong group-hover:bg-surface group-hover:text-text group-focus-visible:h-full group-focus-visible:w-full group-focus-visible:border-line-strong group-focus-visible:bg-surface"
          }`}
        >
          <span className={`flex items-center gap-1 transition-opacity ${shown ? "" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`}>
            <SlidersHorizontal size={11} aria-hidden="true" />
            <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
          </span>
        </span>
      </button>

      <div
        {...slide.handlers}
        className="flex shrink-0 cursor-grab touch-none select-none items-center gap-2 border-b border-rule py-2 pl-5 pr-2 active:cursor-grabbing"
      >
        <h2 className="flex-1 font-serif text-[15px] font-semibold">Pomodoro settings</h2>
        <button
          onClick={() => onOpenChange(false)}
          className="grid size-8 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
          aria-label="Close pomodoro settings"
          title="Close (Esc)"
        >
          <X size={16} />
        </button>
      </div>

      <div inert={!open && slide.offset === null} className="grid min-h-0 flex-1 gap-x-8 overflow-y-auto px-5 pb-4 pt-1 sm:grid-cols-2">
        <div className="divide-y divide-rule">
          <Stepper label="Focus" unit="min" value={settings.focus} limits={LIMITS.focus} onChange={(v) => onChange({ focus: v })} />
          <Stepper label="Short break" unit="min" value={settings.shortBreak} limits={LIMITS.shortBreak} onChange={(v) => onChange({ shortBreak: v })} />
          <Stepper label="Long break" unit="min" value={settings.longBreak} limits={LIMITS.longBreak} onChange={(v) => onChange({ longBreak: v })} />
          <Stepper label="Long break after" unit="focus" value={settings.longEvery} limits={LIMITS.longEvery} onChange={(v) => onChange({ longEvery: v })} />
        </div>

        <div className="flex flex-col gap-2.5 max-sm:mt-2 max-sm:border-t max-sm:border-rule max-sm:pt-3 sm:pt-3.5">
          <Check checked={settings.autoBreak} onChange={(v) => onChange({ autoBreak: v })}>
            Start the break when a focus ends
          </Check>
          <Check checked={settings.autoStart} onChange={(v) => onChange({ autoStart: v })}>
            Start the next focus when a break ends
          </Check>
          <Check checked={settings.sound} onChange={(v) => onChange({ sound: v })}>
            Chime when a focus or break ends
          </Check>
          <p className="mt-1 text-xs text-muted">
            A focus is saved as a pomodoro (one cut short is kept but not counted). When a break starts, a running project timer is paused for it and picks up again with the next focus.
          </p>
          <button
            onClick={onReset}
            disabled={Object.keys(DEFAULTS).every((k) => settings[k] === DEFAULTS[k])}
            className="-ml-2 inline-flex h-8 items-center gap-1.5 self-start px-2 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:pointer-events-none disabled:opacity-40"
          >
            <RotateCcw size={13} /> Reset to defaults
          </button>
        </div>
      </div>
    </aside>
  );
}

/** Where the panel and its tab go: the panel centred over the pomodoro as far as the window allows, the
 *  tab right above the pomodoro's middle (`tabX`, from the panel's left). Followed as the window and the
 *  pomodoro change size, since the chip shifts when a project timer appears beside it. */
function useAnchor(anchor) {
  const [place, setPlace] = useState({ left: MARGIN, width: WIDTH, tabX: WIDTH / 2 });
  useLayoutEffect(() => {
    const target = document.querySelector(`${anchor === "screen" ? "[data-pomodoro-screen]" : "[data-app-header]"} [data-pomodoro-anchor]`);
    if (!target) return;
    const measure = () => {
      const t = target.getBoundingClientRect();
      const mid = t.left + t.width / 2;
      const vw = document.documentElement.clientWidth;
      const width = Math.min(WIDTH, vw - 2 * MARGIN);
      const left = Math.min(vw - MARGIN - width, Math.max(MARGIN, mid - width / 2));
      setPlace({ left, width, tabX: mid - left });
    };
    measure();
    // A resize of the pomodoro or of the boxes around it can move it sideways (the header's centre column
    // widens when the logo's web font arrives, the page when a scrollbar comes or goes), so those are watched too
    const watch = new ResizeObserver(measure);
    for (const el of [target, target.parentElement, target.parentElement?.parentElement, document.documentElement]) if (el) watch.observe(el);
    window.addEventListener("resize", measure);
    let live = true;
    document.fonts?.ready.then(() => live && measure());
    return () => {
      live = false;
      watch.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [anchor]);
  return place;
}

function Stepper({ label, unit, value, limits: [min, max], onChange }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const set = (n) => onChange(Math.min(max, Math.max(min, Math.round(n))));
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(n)) return setDraft(String(value));
    set(n);
    setDraft(String(Math.min(max, Math.max(min, Math.round(n)))));
  };
  const step = "grid size-8 place-items-center border border-line-strong text-muted transition-colors hover:border-text hover:text-text disabled:pointer-events-none disabled:opacity-35";

  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-[13px] font-semibold">{label}</span>
      <div className="flex items-center gap-1.5">
        <button onClick={() => set(value - 1)} disabled={value <= min} className={step} aria-label={`Decrease ${label.toLowerCase()}`}>
          <Minus size={14} />
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 3))}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          inputMode="numeric"
          aria-label={`${label} (${unit})`}
          className="figures h-8 w-11 border border-line-strong bg-transparent text-center text-[15px] font-semibold outline-none focus:border-text"
        />
        <button onClick={() => set(value + 1)} disabled={value >= max} className={step} aria-label={`Increase ${label.toLowerCase()}`}>
          <Plus size={14} />
        </button>
        <span className="w-9 text-xs text-faint">{unit}</span>
      </div>
    </div>
  );
}

function Check({ checked, onChange, children }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-(--text)"
      />
      <span>{children}</span>
    </label>
  );
}
