import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Coffee, Maximize, Minimize, PanelRight, Pause, PictureInPicture2, Play, Search, SkipForward, Square, Tag, Timer, X } from "lucide-react";
import { Button } from "./Modal";
import { TimerNote } from "./Header";
import FocusTag from "./FocusTag";
import ProjectSearch from "./ProjectSearch";
import { iconFor, inkText, tint } from "../lib/palette";
import { fmtClock, fmtCountdown } from "../lib/time";
import { scopedKey } from "../lib/storage";
import { __, useT } from "../i18n";


export const TONES = { focus: "var(--accent)", rest: "var(--accent-2)", idle: "var(--muted)" };

const PANEL_KEY = "pt-pomo-right";
const WIDE = "(min-width: 1280px)"; // wide enough for the panel beside the timer; narrower, it slides over it

/** Whether the side panel is out. Remembered in this browser; the first time, out only on a wide screen. */
function usePanel() {
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(scopedKey(PANEL_KEY));
      if (saved === "1" || saved === "0") return saved === "1";
    } catch {
      // storage blocked: it just starts from the default
    }
    return window.matchMedia(WIDE).matches;
  });
  const set = (next) => {
    setOpen(next);
    try {
      localStorage.setItem(scopedKey(PANEL_KEY), next ? "1" : "0");
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
      phase === "idle" ? __("Ready to focus")
      : phase === "focus" ? __("Focus")
      : phase === "focusPaused" ? __("Focus · paused")
      : phase === "breakWait" ? __("{kind} · ready to start", { kind: long ? __("Long break") : __("Break") })
      : phase === "break" ? (long ? __("Long break") : __("Break"))
      : phase === "breakPaused" ? __("{kind} · paused", { kind: long ? __("Long break") : __("Break") })
      : __("Break over · next focus"),
    timerLabel: breaking || phase === "breakWait" ? __("Break time left") : phase === "focusPaused" ? __("Focus time left, paused") : __("Focus time left"),
  };
}

/** The pomodoro with the whole screen to itself: the same countdown and buttons as the header chip, a
 *  small, optional card for the project being worked on, and a side panel that can be put away: on the
 *  right, the project being worked on (`renderDetail(project)`: its to-dos and sessions).
 *
 *  A project picked here is only chosen: it starts together with the next focus (`startFocusOn`).
 *  Once a project timer is running, or a focus is already going, there is no next focus to wait for,
 *  so picking one starts its timer now (switching away from the one that was running).
 *  The choice lives in this screen and goes when it closes. The search finds a project or task to pick by
 *  name, or one of their to-dos (`todos`, from todoEntries: picked, the time goes on that to-do), with
 *  `searchHint` the shortcut as shown (without one the screen leaves the keys to the browser); or the Tasks
 *  tab (`onTasks`, which leaves the screen for it). */
export default function PomodoroScreen({
  pomodoro, pomodorosToday = 0, projects, todos = [], runningProject, runningSession, clock, heldProject, heldSeconds,
  onStartTimer, onStopTimer, onStopFocus, onSaveNote, settingsOpen, onClose, renderDetail, onMiniPlayer, statusesById, searchHint, onTasks,
}) {
  useT();
  const { phase, settings } = pomodoro;
  const focusing = phase === "focus" || phase === "focusPaused";
  const inBreak = phase === "breakWait" || phase === "break" || phase === "breakPaused";
  const long = pomodoro.breakKind === "long";
  const ref = useRef(null);

  const [chosenId, setChosenId] = useState(null);
  const [chosenTodoId, setChosenTodoId] = useState(null); // a to-do of the chosen one, found by name
  const hasRunning = Boolean(runningProject);
  useEffect(() => {
    if (hasRunning) setChosenId(null);
  }, [hasRunning]);
  const chosen = hasRunning ? null : projects.find((p) => p.id === chosenId) ?? null;
  const chosenTodo = chosen ? todos.find((x) => x.todoId === chosenTodoId && x.subjectId === chosen.id) ?? null : null;
  const live = hasRunning || focusing;
  const [rightOpen, setRightOpen] = usePanel();
  // The project the right panel shows: the one being worked on, else the one picked for the next focus,
  // else the one paused for the break
  const active = runningProject ?? chosen ?? heldProject ?? null;

  const startFocus = () => (chosen ? pomodoro.startFocusOn(chosen.id, chosenTodo?.todoId ?? null) : pomodoro.startFocus());

  // A project or task found by name: picked (never un-picked), and shown in the right panel.
  // A to-do found by name picks what it belongs to, with the time going on the to-do.
  const [searchOpen, setSearchOpen] = useState(false);
  const pickFound = (id, todoId = null) => {
    setSearchOpen(false);
    if (live) {
      if (id !== runningProject?.id || todoId) onStartTimer(id, todoId);
    } else {
      pomodoro.setFocusFor(null); // a chore and a chosen project are never both
      setChosenId(id);
      setChosenTodoId(todoId);
    }
    setRightOpen(true);
  };

  // Esc leaves, unless it is meant for the settings drawer, the search or the session note, which handle it themselves
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || settingsOpen || searchOpen) return;
      if (e.target instanceof Element && e.target.closest("textarea, input")) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [settingsOpen, searchOpen, onClose]);

  // Ctrl+F (⌘F) finds a project here too, unless the settings drawer is out
  useEffect(() => {
    if (!searchHint) return;
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "f" || settingsOpen) return;
      e.preventDefault();
      if (searchOpen) document.getElementById("project-search")?.select();
      else setSearchOpen(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [searchHint, searchOpen, settingsOpen]);

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
      aria-label={__("Pomodoro")}
      data-pomodoro-screen
      tabIndex={-1}
      className="fade-in fixed inset-0 z-[45] flex flex-col overflow-hidden bg-bg outline-none"
      style={tone === "idle" ? undefined : { backgroundImage: `linear-gradient(${tint(color, 6)}, ${tint(color, 6)})` }}
    >
      <div className="shrink-0 border-b-[3px] border-double border-line-strong">
        <div className="flex h-14 items-center gap-2 px-4 sm:h-16 sm:gap-3 sm:px-6">
          <Timer size={20} aria-hidden="true" className="max-sm:hidden" />
          <h1 className="font-serif text-lg font-semibold tracking-tight max-sm:sr-only">{__("Pomodoro")}</h1>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {(projects.length > 0 || onTasks) && (
              <Button
                variant="outline"
                onClick={() => setSearchOpen(true)}
                className="w-9 px-0"
                aria-label={__("Find a project, task or to-do")}
                title={searchHint ? __("Find a project, task or to-do ({searchHint})", { searchHint }) : __("Find a project, task or to-do")}
              >
                <Search size={16} />
              </Button>
            )}
            {onMiniPlayer && (
              <Button
                variant="outline"
                onClick={onMiniPlayer}
                className="w-9 px-0 max-sm:hidden"
                aria-label={__("Open the mini clock")}
                title={__("Open the mini clock")}
              >
                <PictureInPicture2 size={16} />
              </Button>
            )}
            {canBrowserFull && (
              <Button
                variant="outline"
                onClick={toggleBrowserFull}
                className="w-9 px-0 max-sm:hidden"
                aria-label={browserFull ? __("Leave browser full screen") : __("Fill the whole screen")}
                title={browserFull ? __("Leave browser full screen") : __("Fill the whole screen")}
              >
                {browserFull ? <Minimize size={16} /> : <Maximize size={16} />}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setRightOpen(!rightOpen)}
              className={`w-9 px-0 ${rightOpen ? "bg-surface-2" : ""}`}
              aria-pressed={rightOpen}
              aria-label={rightOpen ? __("Hide the project panel") : __("Show the project panel")}
              title={rightOpen ? __("Hide the project panel") : __("Show the project panel")}
            >
              <PanelRight size={16} />
            </Button>
            <Button variant="outline" onClick={onClose} className="w-9 px-0" aria-label={__("Close full screen")} title={__("Close (Esc)")}>
              <X size={17} />
            </Button>
          </div>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* Below the wide layout the panel slides over the timer; this closes it again */}
        {rightOpen && (
          <button
            className="absolute inset-0 z-10 bg-[var(--scrim)] xl:hidden"
            aria-label={__("Close the side panel")}
            tabIndex={-1}
            onClick={() => setRightOpen(false)}
          />
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
              {!pomodoro.continuous && (
                <>
                  <span className="flex items-center gap-1.5" title={__("Focus periods in this set")} aria-label={__("Focus {position} of {longEvery} in this set", { position: pomodoro.position, longEvery: settings.longEvery })}>
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
                </>
              )}
              {pomodorosToday > 0 ? (
                <span>{pomodoro.continuous ? "" : "· "}{__("{n} today", { n: pomodorosToday })}</span>
              ) : (
                pomodoro.continuous && <span>{__("No breaks")}</span>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              {controlsFor(pomodoro, startFocus, onStopFocus, hasRunning).map((c) => (
                <ActionButton key={c.id} {...c} />
              ))}
            </div>

            {/* What this focus is for, saved with the pomodoro: a project or task (chosen below) or a chore, never both; a chore goes when the focus ends */}
            <FocusTag
              value={pomodoro.focusFor}
              onChange={(v) => {
                // A project is chosen for the next focus (as the search does); a chore takes the place of any chosen one
                if (v?.project_id) pickFound(v.project_id, v.todo_id ?? null);
                else {
                  if (v) setChosenId(null);
                  pomodoro.setFocusFor(v);
                }
              }}
              choices={projects}
            >
              {(open, toggle) => (
                <button
                  onClick={toggle}
                  aria-expanded={open}
                  className={`inline-flex h-9 max-w-full items-center gap-2 border border-dashed border-line-strong px-3 text-[13px] transition-colors hover:border-text hover:bg-surface-2 ${
                    open ? "bg-surface-2" : ""
                  }`}
                  title={__("Say what this focus is for: a project, a task, or a chore of your own")}
                >
                  <Tag size={14} className={pomodoro.focusFor ? "text-accent" : "text-muted"} aria-hidden="true" />
                  {pomodoro.focusFor?.label ? (
                    <span className="min-w-0 truncate">
                      <span className="text-muted">{__("For ")}</span>
                      <b className="font-semibold">{pomodoro.focusFor.label}</b>
                    </span>
                  ) : (
                    <span className="text-muted">{__("What is this focus for?")}</span>
                  )}
                </button>
              )}
            </FocusTag>

            <ProjectCard
              runningProject={runningProject}
              runningSession={runningSession}
              clock={clock}
              heldProject={heldProject}
              heldSeconds={heldSeconds}
              chosen={chosen}
              chosenTodo={chosenTodo}
              noProjects={projects.length === 0}
              onClear={() => setChosenId(null)}
              onStop={onStopTimer}
              onSaveNote={onSaveNote}
            />
          </div>
        </main>

        {rightOpen && (
          <SidePanel title={active?.name ?? __("Project")} onClose={() => setRightOpen(false)} padded>
            {active ? (
              renderDetail?.(active)
            ) : (
              <div className="grid flex-1 place-items-center border border-dashed border-line-strong p-6 text-center">
                <p className="text-[13px] text-muted">{__("Pick a project or task to see its to-dos and sessions here.")}</p>
              </div>
            )}
          </SidePanel>
        )}
      </div>

      {searchOpen && (
        <ProjectSearch
          projects={projects}
          todos={todos}
          statusesById={statusesById}
          onClose={() => setSearchOpen(false)}
          onPick={pickFound}
          onTasks={onTasks}
          onChore={(label) => {
            setSearchOpen(false);
            setChosenId(null); // a chore takes the place of any chosen project
            pomodoro.setFocusFor({ project_id: null, todo_id: null, label });
          }}
        />
      )}
    </div>,
    document.body
  );
}

/** The side panel of the full screen: beside the timer on a wide screen, over it on a narrow one. It isn't
 *  drawn at all while it is put away, so what it holds (a half-typed note) is saved as it goes. */
function SidePanel({ title, onClose, padded = false, children }) {
  useT();
  return (
    <aside
      aria-label={title}
      className={`z-20 flex min-h-0 shrink-0 flex-col border-line-strong bg-surface [--row-bg:var(--surface)] max-xl:absolute max-xl:inset-y-0 max-xl:w-[min(22rem,90vw)] border-l max-xl:right-0 xl:w-[26rem]`}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-line-strong py-2 pl-4 pr-2">
        <h2 className="min-w-0 flex-1 truncate font-serif text-[15px] font-semibold" title={title}>
          {title}
        </h2>
        <button
          onClick={onClose}
          className="grid size-8 shrink-0 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
          aria-label={__("Hide the project panel")}
          title={__("Hide")}
        >
          <PanelRight size={16} />
        </button>
      </div>
      <div className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${padded ? "px-4 py-4" : "py-2"}`}>{children}</div>
    </aside>
  );
}

/** What the buttons are in each phase, in the same order as the header chip's. Stopping a focus
 *  (`stopFocus`) also ends the running project timer; stopping a break (`p.dismiss`) leaves it be.
 *  With `stopTimer`, a running project timer also gets a button of its own that stops only it. */
export function controlsFor(p, startFocus, stopFocus, hasRunning, stopTimer) {
  const controls = phaseControls(p, startFocus, stopFocus, hasRunning);
  if (!hasRunning || !stopTimer) return controls;
  return [
    ...controls,
    { id: "stop-timer", label: __("Stop timer"), icon: Timer, onClick: stopTimer, outline: true, hint: __("Stop the project timer, keep the pomodoro going") },
  ];
}

function phaseControls(p, startFocus, stopFocus, hasRunning) {
  const stopsFocus = p.phase === "focus" || p.phase === "focusPaused";
  const stop = {
    id: "stop",
    label: __("Stop"),
    icon: Square,
    onClick: stopsFocus ? stopFocus : p.dismiss,
    hint: stopsFocus && hasRunning ? __("Stop the focus and the project timer") : __("Stop the pomodoro"),
  };
  const skip = { id: "skip", label: __("Skip break"), icon: SkipForward, onClick: startFocus, hint: __("Skip the break and start the next focus") };
  switch (p.phase) {
    case "focus":
      return [
        { id: "pause", label: __("Pause"), icon: Pause, onClick: p.pause, primary: true, tone: "focus", hint: __("Pause the focus") },
        ...(p.continuous ? [] : [{ id: "break", label: __("Break now"), icon: Coffee, onClick: p.breakNow, hint: __("End the focus early and take a break now") }]),
        stop,
      ];
    case "focusPaused":
      return [{ id: "resume", label: __("Resume"), icon: Play, onClick: p.resume, primary: true, tone: "focus", hint: __("Resume the focus") }, stop];
    case "breakWait":
      return [{ id: "start", label: __("Start break"), icon: Play, onClick: p.startBreak, primary: true, tone: "rest" }, skip, stop];
    case "break":
      return [{ id: "pause", label: __("Pause"), icon: Pause, onClick: p.pauseBreak, primary: true, tone: "rest", hint: __("Pause the break") }, skip, stop];
    case "breakPaused":
      return [{ id: "resume", label: __("Resume"), icon: Play, onClick: p.resumeBreak, primary: true, tone: "rest", hint: __("Resume the break") }, skip, stop];
    case "ready":
      return [{ id: "focus", label: __("Focus"), icon: Play, onClick: startFocus, primary: true, tone: "focus", hint: __("Start the next focus") }, stop];
    default:
      return [{ id: "focus", label: __("Focus"), icon: Play, onClick: startFocus, primary: true, tone: "focus", hint: __("Start a focus") }];
  }
}

export function ActionButton({ label, hint, icon: Icon, onClick, primary, tone = "focus", compact = false, outline = false }) {
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
      <Icon size={compact ? 13 : 15} fill={Icon === Coffee || outline ? "none" : "currentColor"} aria-hidden="true" />
      {compact ? <span className="sr-only">{label}</span> : label}
    </button>
  );
}

/** The project being worked on, if any. Every state of the card is the same height, so picking a
 *  project moves nothing on the screen. */
function ProjectCard({ runningProject, runningSession, clock, heldProject, heldSeconds, chosen, chosenTodo, noProjects, onClear, onStop, onSaveNote }) {
  useT();
  return (
    <section className="w-full max-w-2xl shrink-0" aria-label={__("Project")}>
      <h2 className="mb-1.5 text-xs font-semibold text-muted">
        {runningProject ? __("Working on") : chosen ? __("Next focus on") : heldProject ? __("Paused for the break") : __("Project")}
      </h2>

      {runningProject ? (
        <RunningCard project={runningProject} session={runningSession} clock={clock} onStop={onStop} onSaveNote={onSaveNote} />
      ) : chosen ? (
        <ChosenCard project={chosen} todo={chosenTodo} onClear={onClear} />
      ) : heldProject ? (
        <HeldCard project={heldProject} seconds={heldSeconds} />
      ) : (
        <div className="flex h-12 items-center justify-between gap-3 border border-dashed border-line-strong px-4 text-[13px] text-muted">
          <span className="truncate">{noProjects ? __("No open projects or tasks yet") : __("Nothing picked")}</span>
          <span className="shrink-0 font-serif text-xs italic text-faint">{__("optional")}</span>
        </div>
      )}
    </section>
  );
}

function RunningCard({ project, session, clock, onStop, onSaveNote }) {
  useT();
  const edge = tint(project.color, 55);
  return (
    <div className="relative flex h-12 items-stretch border" style={{ borderColor: edge, background: tint(project.color, 10) }}>
      <div className="flex min-w-0 flex-1 items-center gap-3 px-4">
        <span className="blink-dot size-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-serif text-lg italic">{project.name}</span>
        <span className="figures whitespace-nowrap text-xl font-semibold" role="timer" aria-label={__("Time on {name}", { name: project.name })}>
          {fmtClock(clock)}
        </span>
      </div>
      {session && <TimerNote key={session.id} session={session} project={project} edge={edge} onSave={onSaveNote} up />}
      <button
        onClick={onStop}
        className="flex items-center gap-1.5 border-l px-4 text-xs font-semibold transition-colors hover:bg-surface-2"
        style={{ borderColor: edge }}
        aria-label={__("Stop {name} timer", { name: project.name })}
        title={__("Stop {name} timer", { name: project.name })}
      >
        <Square size={10} fill="currentColor" aria-hidden="true" />
        <span className="max-sm:hidden">{__("Stop")}</span>
      </button>
    </div>
  );
}

function ChosenCard({ project, todo, onClear }) {
  useT();
  const Icon = iconFor(project.icon);
  const edge = tint(project.color, 55);
  return (
    <div className="flex h-12 items-stretch border" style={{ borderColor: edge, background: tint(project.color, 10) }}>
      <div className="flex min-w-0 flex-1 items-center gap-3 px-4">
        <Icon size={16} style={{ color: inkText(project.color) }} className="shrink-0" aria-hidden="true" />
        <span className={`min-w-0 truncate font-serif text-lg italic ${todo ? "shrink" : "flex-1"}`}>{project.name}</span>
        {todo && (
          <span className="min-w-0 flex-1 truncate text-[13px] text-muted" title={todo.name}>
            · {todo.name}
          </span>
        )}
      </div>
      <button
        onClick={onClear}
        className="grid w-11 place-items-center border-l transition-colors hover:bg-surface-2"
        style={{ borderColor: edge }}
        aria-label={__("Don't use {name}", { name: project.name })}
        title={__("Don't pick a project")}
      >
        <X size={15} />
      </button>
    </div>
  );
}

function HeldCard({ project, seconds }) {
  useT();
  return (
    <div className="flex h-12 items-center gap-3 border border-dashed px-4 text-muted" style={{ borderColor: tint(project.color, 55) }}>
      <Pause size={12} fill="currentColor" className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate font-serif text-lg italic">{project.name}</span>
      <span className="figures whitespace-nowrap text-xl font-semibold" role="timer" aria-label={__("Time on {name}, paused", { name: project.name })}>
        {fmtClock(seconds)}
      </span>
      <span className="text-xs max-sm:hidden">{__("Starts again with the next focus")}</span>
    </div>
  );
}
