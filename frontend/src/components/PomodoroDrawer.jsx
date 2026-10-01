import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, Clock, GripVertical, Minus, Plus, RotateCcw, X } from "lucide-react";
import { DEFAULTS, LIMITS } from "../hooks/usePomodoro";

/**
 * Pomodoro settings in a panel that lives off the right edge of the screen. It
 * follows the pointer while you drag it by its tab or its title, and settles
 * open or shut when you let go; clicking the tab and Esc do the same.
 */
export default function PomodoroDrawer({ open, onOpenChange, settings, onChange, onReset }) {
  const panel = useRef(null);
  const drag = useRef(null);
  const dragged = useRef(false); // a drag that started on the tab must not also count as its click
  const [offset, setOffset] = useState(null); // px the panel is pushed right of fully open, while dragging
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onOpenChange(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const clampOffset = (d, dx) => Math.min(d.width, Math.max(0, d.from + dx));

  const onPointerDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.currentTarget.tagName !== "BUTTON" && e.target.closest("button")) return; // the title bar's own buttons
    const width = panel.current.offsetWidth;
    drag.current = { x0: e.clientX, last: e.clientX, dir: 0, from: open ? 0 : width, width, moved: false };
    dragged.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < 5) return;
    d.moved = true;
    if (e.clientX !== d.last) d.dir = Math.sign(e.clientX - d.last);
    d.last = e.clientX;
    setOffset(clampOffset(d, dx));
  };

  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    dragged.current = true;
    const at = clampOffset(d, e.clientX - d.x0);
    // Past either end of the middle band it goes where it already is; in the band, where it was heading
    const band = d.width * 0.2;
    const next = Math.abs(at - d.width / 2) > band ? at < d.width / 2 : d.dir < 0;
    setOffset(null);
    onOpenChange(next);
  };

  const drags = { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };

  return (
    <aside
      ref={panel}
      id={id}
      aria-label="Pomodoro settings"
      className="fixed right-0 top-0 z-40 flex h-full w-[min(20rem,calc(100vw-2.5rem))] flex-col border-l border-line-strong bg-surface transition-transform duration-200 ease-out"
      style={{
        transform: offset !== null ? `translateX(${offset}px)` : open ? "translateX(0)" : "translateX(100%)",
        transition: offset !== null ? "none" : undefined,
      }}
    >
      {/* The tab stays on screen when the panel is away, so there is always something to pull it in by */}
      <button
        {...drags}
        onClick={() => {
          if (!dragged.current) onOpenChange(!open);
          dragged.current = false;
        }}
        className="absolute right-full top-28 flex w-7 cursor-grab touch-none flex-col items-center gap-1 border-y border-l border-line-strong bg-surface py-2 text-muted transition-colors hover:text-text active:cursor-grabbing"
        aria-label={open ? "Close pomodoro settings" : "Open pomodoro settings"}
        aria-expanded={open}
        aria-controls={id}
      >
        <Clock size={16} aria-hidden="true" />
        <ChevronLeft size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      <div
        {...drags}
        className="flex shrink-0 cursor-grab touch-none select-none items-center gap-1 border-b-[3px] border-double border-line-strong py-3 pl-2 pr-3 active:cursor-grabbing"
      >
        <GripVertical size={16} className="text-faint" aria-hidden="true" />
        <h2 className="flex-1 font-serif text-lg font-semibold">Pomodoro</h2>
        <button
          onClick={() => onOpenChange(false)}
          className="grid size-9 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>

      <div inert={!open} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <p className="text-[13px] text-muted">
          A focus period runs on the project's timer and is logged. Breaks are not.
        </p>

        <div className="mt-3 divide-y divide-rule border-y border-rule">
          <Stepper label="Focus" unit="min" value={settings.focus} limits={LIMITS.focus} onChange={(v) => onChange({ focus: v })} />
          <Stepper label="Short break" unit="min" value={settings.shortBreak} limits={LIMITS.shortBreak} onChange={(v) => onChange({ shortBreak: v })} />
          <Stepper label="Long break" unit="min" value={settings.longBreak} limits={LIMITS.longBreak} onChange={(v) => onChange({ longBreak: v })} />
          <Stepper label="Long break after" unit="focus" value={settings.longEvery} limits={LIMITS.longEvery} onChange={(v) => onChange({ longEvery: v })} />
        </div>

        <div className="mt-3 space-y-2.5">
          <Check checked={settings.autoStart} onChange={(v) => onChange({ autoStart: v })}>
            Start the next focus when a break ends
          </Check>
          <Check checked={settings.sound} onChange={(v) => onChange({ sound: v })}>
            Chime when a focus or break ends
          </Check>
        </div>

        <button
          onClick={onReset}
          disabled={Object.keys(DEFAULTS).every((k) => settings[k] === DEFAULTS[k])}
          className="mt-5 inline-flex h-8 items-center gap-1.5 px-2 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:pointer-events-none disabled:opacity-40"
        >
          <RotateCcw size={13} /> Reset to defaults
        </button>
      </div>
    </aside>
  );
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
