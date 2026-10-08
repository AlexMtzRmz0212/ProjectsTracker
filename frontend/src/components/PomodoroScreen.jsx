import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Coffee, Maximize, Minimize, PanelLeft, PanelRight, Pause, PictureInPicture2, Play, SkipForward, Square, Timer, X } from "lucide-react";
import { Button } from "./Modal";
import { TimerNote } from "./Header";
import { iconFor, inkText, tint } from "../lib/palette";
import { fmtClock, fmtCountdown } from "../lib/time";

export const TONES = { focus: "var(--accent)", rest: "var(--accent-2)", idle: "var(--muted)" };

const PANEL_KEYS = { left: "pt-pomo-left", right: "pt-pomo-right" };
const WIDE = "(min-width: 1280px)"; // wide enough for both panels beside the timer; narrower, they slide over it

/** Whether a side panel is out. Remembered in this browser; the first time, out only on a wide screen. */
function usePanel(side) {
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(PANEL_KEYS[side]);
      if (saved === "1" || saved === "0") return saved === "1";
    } catch {
      // storage blocked: it just starts from the default
    }
    return window.matchMedia(WIDE).matches;
  });
  const set = (next) => {
    setOpen(next);
    try {
      localStorage.setItem(PANEL_KEYS[side], next ? "1" : "0");
    } catch {
      // storage blocked: it just won't survive a reload
    }
  };
  return [open, set];
}

/** What the countdown shows in the pomodoro's current phase: its tone and color, the time left and how far
 *  through the period it is, a label for the phase and one for the timer. Shared by the full screen and the
 *  mini clock. */
export function phaseView(pomodoro) {
  const { phase } = pomodoro;
  const long = pomodoro.breakKind === "long";
  const focusing = phase === "focus" || phase === "focusPaused";
  const breaking = phase === "break" || phase === "breakPaused";
  const tone = phase === "focus" ? "focus" : phase === "idle" || phase === "focusPaused" ? "idle" : "rest";
  return {
    tone,
    color: TONES[tone],
    remaining: breaking || phase === "breakWait" ? pomodoro.breakRemaining : pomodoro.focusRemaining,
    progress: breaking ? pomodoro.breakProgress : focusing ? pomodoro.focusProgress : 0,
    label:
      phase === "idle" ? "Ready to focus"
      : phase === "focus" ? "Focus"
      : phase === "focusPaused" ? "Focus · paused"
      : phase === "breakWait" ? `${long ? "Long break" : "Break"} · ready to start`
      : phase === "break" ? (long ? "Long break" : "Break")
      : phase === "breakPaused" ? `${long ? "Long break" : "Break"} · paused`
      : "Break over · next focus",
    timerLabel: breaking || phase === "breakWait" ? "Break time left" : phase === "focusPaused" ? "Focus time left, paused" : "Focus time left",
  };
}

/** The pomodoro with the whole screen to itself: the same countdown and buttons as the header chip, a
 *  small, optional card for the project being worked on, and two side panels that can each be put away:
 *  the open projects to pick from on the left, and on the right the project being worked on
 *  (`renderDetail(project)`: its to-dos, notes and sessions).
 *
 *  A project picked here is only chosen: it starts together with the next focus (`startFocusOn`).
 *  Once a project timer is running, or a focus is already going, there is no next focus to wait for,
 *  so picking one starts its timer now (switching away from the one that was running).
 *  The choice lives in this screen and goes when it closes. */
export default function PomodoroScreen({
  pomodoro, pomodorosToday = 0, projects, runningProject, runningSession, clock, heldProject, heldSeconds,
  onStartTimer, onStopTimer, onStopFocus, onSaveNote, settingsOpen, onClose, renderDetail, onMiniPlayer,
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
  const [leftOpen, setLeftOpen] = usePanel("left");
  const [rightOpen, setRightOpen] = usePanel("right");
  // The project the right panel shows: the one being worked on, else the one picked for the next focus,
  // else the one paused for the break
  const active = runningProject ?? chosen ?? heldProject ?? null;

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

  const { tone, color, remaining, progress, label, timerLabel } = phaseView(pomodoro);

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
      className="fade-in fixed inset-0 z-[45] flex flex-col overflow-hidden bg-bg outline-none"
      style={tone === "idle" ? undefined : { backgroundImage: `linear-gradient(${tint(color, 6)}, ${tint(color, 6)})` }}
    >
      <div className="shrink-0 border-b-[3px] border-double border-line-strong">
        <div className="flex h-14 items-center gap-2 px-4 sm:h-16 sm:gap-3 sm:px-6">
          <Button
            variant="outline"
            onClick={() => setLeftOpen(!leftOpen)}
            className={`w-9 px-0 ${leftOpen ? "bg-surface-2" : ""}`}
            aria-pressed={leftOpen}
            aria-label={leftOpen ? "Hide the project list" : "Show the project list"}
            title={leftOpen ? "Hide the project list" : "Show the project list"}
          >
            <PanelLeft size={16} />
          </Button>
          <Timer size={20} aria-hidden="true" className="ml-1 max-sm:hidden" />
          <h1 className="font-serif text-lg font-semibold tracking-tight max-sm:sr-only">Pomodoro</h1>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {onMiniPlayer && (
              <Button
                variant="outline"
                onClick={onMiniPlayer}
                className="w-9 px-0 max-sm:hidden"
                aria-label="Open the mini clock"
                title="Open the mini clock"
              >
                <PictureInPicture2 size={16} />
              </Button>
            )}
            {canBrowserFull && (
              <Button
                variant="outline"
                onClick={toggleBrowserFull}
                className="w-9 px-0 max-sm:hidden"
                aria-label={browserFull ? "Leave browser full screen" : "Fill the whole screen"}
                title={browserFull ? "Leave browser full screen" : "Fill the whole screen"}
              >
                {browserFull ? <Minimize size={16} /> : <Maximize size={16} />}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setRightOpen(!rightOpen)}
              className={`w-9 px-0 ${rightOpen ? "bg-surface-2" : ""}`}
              aria-pressed={rightOpen}
              aria-label={rightOpen ? "Hide the project panel" : "Show the project panel"}
              title={rightOpen ? "Hide the project panel" : "Show the project panel"}
            >
              <PanelRight size={16} />
            </Button>
            <Button variant="outline" onClick={onClose} className="w-9 px-0" aria-label="Close full screen" title="Close (Esc)">
              <X size={17} />
            </Button>
          </div>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* Below the wide layout a panel slides over the timer; this closes it again */}
        {(leftOpen || rightOpen) && (
          <button
            className="absolute inset-0 z-10 bg-[var(--scrim)] xl:hidden"
            aria-label="Close the side panels"
            tabIndex={-1}
            onClick={() => {
              setLeftOpen(false);
              setRightOpen(false);
            }}
          />
        )}

        {leftOpen && (
          <SidePanel side="left" title="Projects" onClose={() => setLeftOpen(false)}>
            <ProjectList projects={projects} runningProject={runningProject} chosen={chosen} live={live} onPick={pick} />
          </SidePanel>
        )}

        {/* Spacing follows the screen's height; the digits follow the room left beside the panels */}
        <main className="min-w-0 flex-1 overflow-y-auto [container-type:inline-size]">
          <div
            className="mx-auto flex min-h-full w-full max-w-5xl flex-col items-center justify-center px-4 sm:px-6"
            style={{ gap: "clamp(0.625rem, 2.6vh, 1.5rem)", paddingBlock: "clamp(0.5rem, 3vh, 2rem)" }}
          >
            <p className="font-serif text-xl font-semibold italic sm:text-2xl" style={{ color: tone === "idle" ? undefined : color }}>
              {label}
            </p>

            <p
              className={`figures font-semibold leading-none tracking-tight ${tone === "idle" ? "text-muted" : ""}`}
              style={{ fontSize: "clamp(4rem, min(26cqw, 25vh), 15rem)", color: tone === "idle" ? undefined : color }}
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

            <ProjectCard
              runningProject={runningProject}
              runningSession={runningSession}
              clock={clock}
              heldProject={heldProject}
              heldSeconds={heldSeconds}
              chosen={chosen}
              noProjects={projects.length === 0}
              onClear={() => setChosenId(null)}
              onStop={onStopTimer}
              onSaveNote={onSaveNote}
            />
          </div>
        </main>

        {rightOpen && (
          <SidePanel side="right" title={active?.name ?? "Project"} onClose={() => setRightOpen(false)} padded>
            {active ? (
              renderDetail?.(active)
            ) : (
              <div className="grid flex-1 place-items-center border border-dashed border-line-strong p-6 text-center">
                <p className="text-[13px] text-muted">Pick a project to see its to-dos, notes and sessions here.</p>
              </div>
            )}
          </SidePanel>
        )}
      </div>
    </div>,
    document.body
  );
}

/** A side panel of the full screen: beside the timer on a wide screen, over it on a narrow one. It isn't
 *  drawn at all while it is put away, so what it holds (a half-typed note) is saved as it goes. */
function SidePanel({ side, title, onClose, padded = false, children }) {
  const left = side === "left";
  return (
    <aside
      aria-label={title}
      className={`z-20 flex min-h-0 shrink-0 flex-col border-line-strong bg-surface max-xl:absolute max-xl:inset-y-0 max-xl:w-[min(22rem,90vw)] ${
        left ? "border-r max-xl:left-0 xl:w-64" : "border-l max-xl:right-0 xl:w-[26rem]"
      }`}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-line-strong py-2 pl-4 pr-2">
        <h2 className="min-w-0 flex-1 truncate font-serif text-[15px] font-semibold" title={title}>
          {title}
        </h2>
        <button
          onClick={onClose}
          className="grid size-8 shrink-0 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
          aria-label={left ? "Hide the project list" : "Hide the project panel"}
          title="Hide"
        >
          {left ? <PanelLeft size={16} /> : <PanelRight size={16} />}
        </button>
      </div>
      <div className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${padded ? "px-4 py-4" : "py-2"}`}>{children}</div>
    </aside>
  );
}

/** What the buttons are in each phase, in the same order as the header chip's. Stopping a focus
 *  (`stopFocus`) also ends the running project timer; stopping a break (`p.dismiss`) leaves it be. */
export function controlsFor(p, startFocus, stopFocus, hasRunning) {
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

export function ActionButton({ label, hint, icon: Icon, onClick, primary, tone = "focus", compact = false }) {
  const color = TONES[tone];
  return (
    <button
      onClick={onClick}
      title={hint ?? label}
      aria-label={compact ? label : undefined}
      className={`inline-flex items-center justify-center gap-2 border font-semibold transition-colors ${
        compact ? "h-9 min-w-9 px-2.5 text-xs" : "h-12 min-w-32 px-6 text-[15px]"
      } ${primary ? "hover:opacity-90" : "border-line-strong hover:bg-surface-2"}`}
      style={primary ? { background: color, borderColor: color, color: "var(--bg)" } : undefined}
    >
      <Icon size={compact ? 13 : 15} fill={Icon === Coffee ? "none" : "currentColor"} aria-hidden="true" />
      {compact ? <span className="sr-only">{label}</span> : label}
    </button>
  );
}

/** The project being worked on, if any. Every state of the card is the same height, so picking a
 *  project moves nothing on the screen. */
function ProjectCard({ runningProject, runningSession, clock, heldProject, heldSeconds, chosen, noProjects, onClear, onStop, onSaveNote }) {
  return (
    <section className="w-full max-w-2xl shrink-0" aria-label="Project">
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
          <span className="truncate">{noProjects ? "No open projects yet" : "No project picked"}</span>
          <span className="shrink-0 font-serif text-xs italic text-faint">optional</span>
        </div>
      )}
    </section>
  );
}

/** The open projects to pick from, one to a row. */
function ProjectList({ projects, runningProject, chosen, live, onPick }) {
  if (projects.length === 0) {
    return <p className="px-4 py-3 font-serif text-[13px] italic text-muted">No open projects yet.</p>;
  }
  return (
    <>
      <p className="px-4 pb-2 text-xs text-faint">{live ? "Pick one to start its timer now" : "Picked now, started with the next focus"}</p>
      <div className="flex flex-col" role="group" aria-label="Projects">
        {projects.map((p) => {
          const Icon = iconFor(p.icon);
          const active = p.id === runningProject?.id || p.id === chosen?.id;
          return (
            <button
              key={p.id}
              onClick={() => onPick(p.id)}
              aria-pressed={active}
              className={`flex min-h-10 w-full items-center gap-2.5 border-l-[3px] px-4 py-1.5 text-left text-[14px] font-medium transition-colors ${
                active ? "" : "border-transparent text-muted hover:bg-surface-2 hover:text-text"
              }`}
              style={active ? { borderColor: p.color, background: tint(p.color, 14) } : undefined}
            >
              <Icon size={15} style={{ color: inkText(p.color) }} className="shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.id === runningProject?.id && <span className="blink-dot size-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </>
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
