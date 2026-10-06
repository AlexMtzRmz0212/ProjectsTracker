import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Coffee, Maximize, Minimize, Pause, Play, SkipForward, Square, Timer, X } from "lucide-react";
import { Button } from "./Modal";
import { TimerNote } from "./Header";
import { iconFor, inkText, tint } from "../lib/palette";
import { fmtClock, fmtCountdown } from "../lib/time";

const TONES = { focus: "var(--accent)", rest: "var(--accent-2)", idle: "var(--muted)" };

/** The pomodoro with the whole screen to itself: the same countdown and buttons as the header chip,
 *  and a small, optional section for the project being worked on.
 *
 *  A project picked here is only chosen: it starts together with the next focus (`startFocusOn`).
 *  Once a project timer is running, or a focus is already going, there is no next focus to wait for,
 *  so picking one starts its timer now (switching away from the one that was running).
 *  The choice lives in this screen and goes when it closes. */
export default function PomodoroScreen({
  pomodoro, pomodorosToday = 0, projects, runningProject, runningSession, clock, heldProject, heldSeconds,
  onStartTimer, onStopTimer, onStopFocus, onSaveNote, settingsOpen, onClose,
}) {
  const { phase, settings } = pomodoro;
  const focusing = phase === "focus" || phase === "focusPaused";
  const inBreak = phase === "breakWait" || phase === "break" || phase === "breakPaused";
  const long = pomodoro.breakKind === "long";
  const ref = useRef(null);

  const [chosenId, setChosenId] = useState(null);
  const hasRunning = Boolean(runningProject);
  useEffect(() => {
    if (hasRunning) setChosenId(null);
  }, [hasRunning]);
  const chosen = hasRunning ? null : projects.find((p) => p.id === chosenId) ?? null;
  const live = hasRunning || focusing;

  const pick = (id) => {
    if (id === runningProject?.id) return;
    if (live) onStartTimer(id);
    else setChosenId((c) => (c === id ? null : id));
  };
  const startFocus = () => (chosen ? pomodoro.startFocusOn(chosen.id) : pomodoro.startFocus());

  // Esc leaves, unless it is meant for the settings drawer or the session note, which handle it themselves
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || settingsOpen) return;
      if (e.target instanceof Element && e.target.closest("textarea, input")) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [settingsOpen, onClose]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // The browser's own full screen, on top of this one: asked for with a button, and left when this closes
  const canBrowserFull = document.fullscreenEnabled;
  const [browserFull, setBrowserFull] = useState(() => Boolean(document.fullscreenElement));
  useEffect(() => {
    const sync = () => setBrowserFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      if (document.fullscreenElement) Promise.resolve(document.exitFullscreen?.()).catch(() => {});
    };
  }, []);
  const toggleBrowserFull = () => {
    const done = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    Promise.resolve(done).catch(() => {});
  };

  const tone = phase === "focus" ? "focus" : phase === "idle" || phase === "focusPaused" ? "idle" : "rest";
  const color = TONES[tone];
  const breaking = phase === "break" || phase === "breakPaused";
  const remaining = breaking || phase === "breakWait" ? pomodoro.breakRemaining : pomodoro.focusRemaining;
  const progress = breaking ? pomodoro.breakProgress : focusing ? pomodoro.focusProgress : 0;
  const label =
    phase === "idle" ? "Ready to focus"
    : phase === "focus" ? "Focus"
    : phase === "focusPaused" ? "Focus · paused"
    : phase === "breakWait" ? `${long ? "Long break" : "Break"} · ready to start`
    : phase === "break" ? (long ? "Long break" : "Break")
    : phase === "breakPaused" ? `${long ? "Long break" : "Break"} · paused`
    : "Break over · next focus";
  const timerLabel = breaking || phase === "breakWait" ? "Break time left" : phase === "focusPaused" ? "Focus time left, paused" : "Focus time left";

  // Squares for the set: the ones done, and the one in hand. After a long break the set is complete.
  const filled = inBreak && long ? settings.longEvery : pomodoro.position - 1;
  const current = inBreak ? -1 : pomodoro.position - 1;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="Pomodoro"
      data-pomodoro-screen
      tabIndex={-1}
      className="fade-in fixed inset-0 z-[45] flex flex-col overflow-y-auto bg-bg outline-none"
      style={tone === "idle" ? undefined : { backgroundImage: `linear-gradient(${tint(color, 6)}, ${tint(color, 6)})` }}
    >
      <div className="shrink-0 border-b-[3px] border-double border-line-strong">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4 sm:h-16 sm:gap-3 sm:px-6">
          <Timer size={20} aria-hidden="true" />
          <h1 className="font-serif text-lg font-semibold tracking-tight">Pomodoro</h1>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {canBrowserFull && (
              <Button
                variant="outline"
                onClick={toggleBrowserFull}
                className="w-9 px-0"
                aria-label={browserFull ? "Leave browser full screen" : "Fill the whole screen"}
                title={browserFull ? "Leave browser full screen" : "Fill the whole screen"}
              >
                {browserFull ? <Minimize size={16} /> : <Maximize size={16} />}
              </Button>
            )}
            <Button variant="outline" onClick={onClose} className="w-9 px-0" aria-label="Close full screen" title="Close (Esc)">
              <X size={17} />
            </Button>
          </div>
        </div>
      </div>

      {/* Spacing and digits follow the screen's height, so the timer and the project section below it fit one screen */}
      <main
        className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-4 sm:px-6"
        style={{ gap: "clamp(0.625rem, 2.6vh, 1.5rem)", paddingBlock: "clamp(0.5rem, 3vh, 2rem)" }}
      >
        <p className="font-serif text-xl font-semibold italic sm:text-2xl" style={{ color: tone === "idle" ? undefined : color }}>
          {label}
        </p>

        <p
          className={`figures font-semibold leading-none tracking-tight ${tone === "idle" ? "text-muted" : ""}`}
          style={{ fontSize: "clamp(4rem, min(26vw, 25vh), 15rem)", color: tone === "idle" ? undefined : color }}
          role="timer"
          aria-label={timerLabel}
          data-pomodoro-anchor
        >
          {fmtCountdown(remaining)}
        </p>

        <div className="h-[3px] w-full max-w-2xl bg-line" aria-hidden="true">
          <div className="h-full origin-left" style={{ background: color, transform: `scaleX(${progress})` }} />
        </div>

        <div className="figures flex items-center gap-3 text-sm text-muted">
          <span className="flex items-center gap-1.5" title="Focus periods in this set" aria-label={`Focus ${pomodoro.position} of ${settings.longEvery} in this set`}>
            {Array.from({ length: settings.longEvery }, (_, i) => (
              <span
                key={i}
                className="size-2.5 border"
                style={{
                  borderColor: i < filled || i === current ? TONES.focus : "var(--line-strong)",
                  background: i < filled ? TONES.focus : undefined,
                }}
              />
            ))}
          </span>
          <span>
            {pomodoro.position}/{settings.longEvery}
          </span>
          {pomodorosToday > 0 && <span>· {pomodorosToday} today</span>}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          {controlsFor(pomodoro, startFocus, onStopFocus, hasRunning).map((c) => (
            <ActionButton key={c.id} {...c} />
          ))}
        </div>
      </main>

      <ProjectSection
        runningProject={runningProject}
        runningSession={runningSession}
        clock={clock}
        heldProject={heldProject}
        heldSeconds={heldSeconds}
        chosen={chosen}
        projects={projects}
        live={live}
        onPick={pick}
        onClear={() => setChosenId(null)}
        onStop={onStopTimer}
        onSaveNote={onSaveNote}
      />
    </div>,
    document.body
  );
}

/** What the buttons are in each phase, in the same order as the header chip's. Stopping a focus
 *  (`stopFocus`) also ends the running project timer; stopping a break (`p.dismiss`) leaves it be. */
function controlsFor(p, startFocus, stopFocus, hasRunning) {
  const stopsFocus = p.phase === "focus" || p.phase === "focusPaused";
  const stop = {
    id: "stop",
    label: "Stop",
    icon: Square,
    onClick: stopsFocus ? stopFocus : p.dismiss,
    hint: stopsFocus && hasRunning ? "Stop the focus and the project timer" : "Stop the pomodoro",
  };
  const skip = { id: "skip", label: "Skip break", icon: SkipForward, onClick: startFocus, hint: "Skip the break and start the next focus" };
  switch (p.phase) {
    case "focus":
      return [
        { id: "pause", label: "Pause", icon: Pause, onClick: p.pause, primary: true, tone: "focus", hint: "Pause the focus" },
        { id: "break", label: "Break now", icon: Coffee, onClick: p.breakNow, hint: "End the focus early and take a break now" },
        stop,
      ];
    case "focusPaused":
      return [{ id: "resume", label: "Resume", icon: Play, onClick: p.resume, primary: true, tone: "focus", hint: "Resume the focus" }, stop];
    case "breakWait":
      return [{ id: "start", label: "Start break", icon: Play, onClick: p.startBreak, primary: true, tone: "rest" }, skip, stop];
    case "break":
      return [{ id: "pause", label: "Pause", icon: Pause, onClick: p.pauseBreak, primary: true, tone: "rest", hint: "Pause the break" }, skip, stop];
    case "breakPaused":
      return [{ id: "resume", label: "Resume", icon: Play, onClick: p.resumeBreak, primary: true, tone: "rest", hint: "Resume the break" }, skip, stop];
    case "ready":
      return [{ id: "focus", label: "Focus", icon: Play, onClick: startFocus, primary: true, tone: "focus", hint: "Start the next focus" }, stop];
    default:
      return [{ id: "focus", label: "Focus", icon: Play, onClick: startFocus, primary: true, tone: "focus", hint: "Start a focus" }];
  }
}

function ActionButton({ label, hint, icon: Icon, onClick, primary, tone = "focus" }) {
  const color = TONES[tone];
  return (
    <button
      onClick={onClick}
      title={hint ?? label}
      className={`inline-flex h-12 min-w-32 items-center justify-center gap-2 border px-6 text-[15px] font-semibold transition-colors ${
        primary ? "hover:opacity-90" : "border-line-strong hover:bg-surface-2"
      }`}
      style={primary ? { background: color, borderColor: color, color: "var(--bg)" } : undefined}
    >
      <Icon size={15} fill={Icon === Coffee ? "none" : "currentColor"} aria-hidden="true" />
      {label}
    </button>
  );
}

/** The project being worked on, if any, and the open projects to pick from. Every state of the card is
 *  the same height and the list is always the full one, so picking a project moves nothing on the screen. */
function ProjectSection({ runningProject, runningSession, clock, heldProject, heldSeconds, chosen, projects, live, onPick, onClear, onStop, onSaveNote }) {
  return (
    <section className="mx-auto w-full max-w-2xl shrink-0 px-4 pb-4 sm:px-6" aria-label="Project">
      <h2 className="mb-1.5 text-xs font-semibold text-muted">
        {runningProject ? "Working on" : chosen ? "Next focus on" : heldProject ? "Paused for the break" : "Project"}
      </h2>

      {runningProject ? (
        <RunningCard project={runningProject} session={runningSession} clock={clock} onStop={onStop} onSaveNote={onSaveNote} />
      ) : chosen ? (
        <ChosenCard project={chosen} onClear={onClear} />
      ) : heldProject ? (
        <HeldCard project={heldProject} seconds={heldSeconds} />
      ) : (
        <div className="flex h-12 items-center justify-between gap-3 border border-dashed border-line-strong px-4 text-[13px] text-muted">
          <span className="truncate">{projects.length ? "No project picked" : "No open projects yet"}</span>
          <span className="shrink-0 font-serif text-xs italic text-faint">optional</span>
        </div>
      )}

      {projects.length > 0 && (
        <>
          <div className="mb-1.5 mt-2.5 flex h-4 items-baseline justify-between gap-3 text-xs">
            <span className="text-muted">Projects</span>
            <span className="truncate text-faint">
              {live ? "Pick one to start its timer now" : "Picked now, started with the next focus"}
            </span>
          </div>
          <div className="flex h-20 flex-wrap content-start gap-1.5 overflow-y-auto" role="group" aria-label="Projects">
            {projects.map((p) => {
              const Icon = iconFor(p.icon);
              const active = p.id === runningProject?.id || p.id === chosen?.id;
              return (
                <button
                  key={p.id}
                  onClick={() => onPick(p.id)}
                  aria-pressed={active}
                  className={`inline-flex h-9 max-w-full items-center gap-2 border px-3 text-[13px] font-medium transition-colors ${
                    active ? "" : "border-line text-muted hover:border-line-strong hover:text-text"
                  }`}
                  style={active ? { borderColor: p.color, background: tint(p.color, 14) } : undefined}
                >
                  <Icon size={15} style={{ color: inkText(p.color) }} className="shrink-0" aria-hidden="true" />
                  <span className="truncate">{p.name}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function RunningCard({ project, session, clock, onStop, onSaveNote }) {
  const edge = tint(project.color, 55);
  return (
    <div className="relative flex h-12 items-stretch border" style={{ borderColor: edge, background: tint(project.color, 10) }}>
      <div className="flex min-w-0 flex-1 items-center gap-3 px-4">
        <span className="blink-dot size-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-serif text-lg italic">{project.name}</span>
        <span className="figures whitespace-nowrap text-xl font-semibold" role="timer" aria-label={`Time on ${project.name}`}>
          {fmtClock(clock)}
        </span>
      </div>
      {session && <TimerNote key={session.id} session={session} project={project} edge={edge} onSave={onSaveNote} up />}
      <button
        onClick={onStop}
        className="flex items-center gap-1.5 border-l px-4 text-xs font-semibold transition-colors hover:bg-surface-2"
        style={{ borderColor: edge }}
        aria-label={`Stop ${project.name} timer`}
        title={`Stop ${project.name} timer`}
      >
        <Square size={10} fill="currentColor" aria-hidden="true" />
        <span className="max-sm:hidden">Stop</span>
      </button>
    </div>
  );
}

function ChosenCard({ project, onClear }) {
  const Icon = iconFor(project.icon);
  const edge = tint(project.color, 55);
  return (
    <div className="flex h-12 items-stretch border" style={{ borderColor: edge, background: tint(project.color, 10) }}>
      <div className="flex min-w-0 flex-1 items-center gap-3 px-4">
        <Icon size={16} style={{ color: inkText(project.color) }} className="shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-serif text-lg italic">{project.name}</span>
      </div>
      <button
        onClick={onClear}
        className="grid w-11 place-items-center border-l transition-colors hover:bg-surface-2"
        style={{ borderColor: edge }}
        aria-label={`Don't use ${project.name}`}
        title="Don't pick a project"
      >
        <X size={15} />
      </button>
    </div>
  );
}

function HeldCard({ project, seconds }) {
  return (
    <div className="flex h-12 items-center gap-3 border border-dashed px-4 text-muted" style={{ borderColor: tint(project.color, 55) }}>
      <Pause size={12} fill="currentColor" className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate font-serif text-lg italic">{project.name}</span>
      <span className="figures whitespace-nowrap text-xl font-semibold" role="timer" aria-label={`Time on ${project.name}, paused`}>
        {fmtClock(seconds)}
      </span>
      <span className="text-xs max-sm:hidden">Starts again with the next focus</span>
    </div>
  );
}
