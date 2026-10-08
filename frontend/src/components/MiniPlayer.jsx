import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GripHorizontal, X } from "lucide-react";
import { ActionButton, controlsFor, phaseView } from "./PomodoroScreen";
import { iconFor, inkText } from "../lib/palette";
import { fmtClock, fmtCountdown } from "../lib/time";

const POS_KEY = "pt-mini-pos";
const WIDTH = 320;
const MARGIN = 8;

function readPos() {
  try {
    const saved = JSON.parse(localStorage.getItem(POS_KEY));
    if (Number.isFinite(saved?.right) && Number.isFinite(saved?.bottom)) return saved;
  } catch {
    // nothing saved, or storage blocked
  }
  return { right: 16, bottom: 16 };
}

/**
 * The pomodoro as a mini clock, like a music player's: drawn into the floating window when there is one
 * (`pip`), otherwise as a small widget over the page that can be dragged by its top edge and remembers
 * where it was left. It shows what the header chip does (the countdown, the phase, the project being
 * worked on) with the same buttons as the full screen. `hidden` keeps the widget away while the full
 * screen is up; a floating window is left alone.
 */
export default function MiniPlayer({
  pomodoro, pip, hidden = false, runningProject, clock, heldProject, heldSeconds, onStopFocus, onClose,
}) {
  const clockFace = (
    <MiniClock
      pomodoro={pomodoro}
      runningProject={runningProject}
      clock={clock}
      heldProject={heldProject}
      heldSeconds={heldSeconds}
      onStopFocus={onStopFocus}
    />
  );
  if (pip) return createPortal(<div className="h-dvh bg-bg text-text">{clockFace}</div>, pip.document.body);
  if (hidden) return null;
  return (
    <Floating onClose={onClose}>
      {clockFace}
    </Floating>
  );
}

/** The clock itself: phase and set position, the countdown, a hairline for how far through it is, the
 *  project, and the buttons for this phase. */
function MiniClock({ pomodoro, runningProject, clock, heldProject, heldSeconds, onStopFocus }) {
  const { tone, color, remaining, progress, label, timerLabel } = phaseView(pomodoro);
  const idle = tone === "idle";
  const project = runningProject ?? heldProject;
  const Icon = project ? iconFor(project.icon) : null;

  return (
    <div className="flex h-full flex-col justify-between gap-2 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate font-serif text-sm font-semibold italic" style={{ color: idle ? undefined : color }}>
          {label}
        </span>
        <span className="figures shrink-0 text-xs text-muted" title="Focus periods in this set">
          {pomodoro.position}/{pomodoro.settings.longEvery}
        </span>
      </div>

      <p
        className={`figures text-5xl font-semibold leading-none tracking-tight ${idle ? "text-muted" : ""}`}
        style={{ color: idle ? undefined : color }}
        role="timer"
        aria-label={timerLabel}
      >
        {fmtCountdown(remaining)}
      </p>

      <div className="h-[2px] w-full bg-line" aria-hidden="true">
        <div className="h-full origin-left" style={{ background: color, transform: `scaleX(${progress})` }} />
      </div>

      <div className="flex h-5 items-center gap-2 text-[13px]">
        {project ? (
          <>
            <Icon size={14} style={{ color: inkText(project.color) }} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-serif italic">{project.name}</span>
            <span
              className={`figures shrink-0 font-semibold ${runningProject ? "" : "text-muted"}`}
              role="timer"
              aria-label={`Time on ${project.name}${runningProject ? "" : ", paused"}`}
            >
              {fmtClock(runningProject ? clock : heldSeconds)}
            </span>
          </>
        ) : (
          <span className="font-serif text-xs italic text-faint">No project timer</span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {controlsFor(pomodoro, pomodoro.startFocus, onStopFocus, Boolean(runningProject)).map((c) => (
          <ActionButton key={c.id} {...c} compact />
        ))}
      </div>
    </div>
  );
}

/** The in-page widget: fixed to the window, pinned by its right and bottom edges so it stays put when
 *  the window is resized, dragged by the bar along its top. */
function Floating({ onClose, children }) {
  const [pos, setPos] = useState(readPos);
  const drag = useRef(null);

  const clamp = ({ right, bottom }) => {
    const width = Math.min(WIDTH, window.innerWidth - 2 * MARGIN);
    return {
      right: Math.min(Math.max(right, MARGIN), Math.max(MARGIN, window.innerWidth - width - MARGIN)),
      bottom: Math.min(Math.max(bottom, MARGIN), Math.max(MARGIN, window.innerHeight - 180 - MARGIN)),
    };
  };
  const shown = clamp(pos);

  const handle = {
    onPointerDown: (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      drag.current = { x: e.clientX, y: e.clientY, from: shown, to: shown };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (!d) return;
      d.to = clamp({ right: d.from.right - (e.clientX - d.x), bottom: d.from.bottom - (e.clientY - d.y) });
      setPos(d.to);
    },
    onPointerUp: () => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(d.to));
      } catch {
        // storage blocked: it just won't survive a reload
      }
    },
  };
  handle.onPointerCancel = handle.onPointerUp;

  return (
    <aside
      aria-label="Mini clock"
      className="fixed z-[38] border border-line-strong bg-bg shadow-[0_6px_24px_rgb(0_0_0/0.25)]"
      style={{ right: shown.right, bottom: `calc(${shown.bottom}px + var(--bottom-bar, 0px))`, width: `min(${WIDTH}px, calc(100vw - ${2 * MARGIN}px))` }}
    >
      <div className="flex h-6 items-center border-b border-line bg-surface">
        <button
          {...handle}
          className="grid h-full flex-1 cursor-grab touch-none place-items-center text-faint active:cursor-grabbing"
          aria-label="Drag the mini clock"
          title="Drag to move"
        >
          <GripHorizontal size={14} aria-hidden="true" />
        </button>
        <button
          onClick={onClose}
          className="grid h-full w-7 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
          aria-label="Close the mini clock"
          title="Close"
        >
          <X size={13} />
        </button>
      </div>
      {children}
    </aside>
  );
}
