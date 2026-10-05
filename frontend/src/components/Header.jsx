import { useEffect, useRef, useState } from "react";
import { Coffee, Inbox, LogOut, Moon, NotebookPen, Pause, Play, Plus, SkipForward, Square, Sun, Timer } from "lucide-react";
import { Button } from "./Modal";
import { tint } from "../lib/palette";
import { fmtClock, fmtCountdown, fmtHM } from "../lib/time";

export default function Header({
  runningProject, runningSession, elapsed, heldProject, heldSeconds, onSaveNote, pomodoro, onStop, onNewProject, theme, onToggleTheme,
  onSignOut, signOutLabel = "Sign out", onInbox, inboxUnread = 0,
}) {
  return (
    <header className="relative z-30 shrink-0 border-b-[3px] border-double border-line-strong bg-bg">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:h-16 sm:gap-3 sm:px-6">
        <div className="flex shrink-0 items-center gap-2">
          <Timer size={20} className="text-text" aria-hidden="true" />
          <span className="hidden font-serif text-lg font-semibold tracking-tight sm:block">ProjectsTracker</span>
        </div>

        <div className="flex min-w-0 flex-1 justify-center">
          <NowTracking
            project={runningProject}
            session={runningSession}
            elapsed={elapsed}
            heldProject={heldProject}
            heldSeconds={heldSeconds}
            onSaveNote={onSaveNote}
            pomodoro={pomodoro}
            onStop={onStop}
          />
        </div>

        <Button variant="outline" onClick={onNewProject} className="shrink-0 px-2.5 sm:px-3.5" aria-label="New project">
          <Plus size={16} strokeWidth={2.5} />
          <span className="hidden md:inline">New project</span>
        </Button>
        {onInbox && (
          <Button
            onClick={onInbox}
            className="relative w-9 shrink-0 px-0"
            aria-label={inboxUnread ? `Interest, ${inboxUnread} new` : "Interest"}
          >
            <Inbox size={17} />
            {inboxUnread > 0 && (
              <span className="figures absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center bg-accent px-1 text-[10px] font-semibold leading-none text-bg">
                {inboxUnread}
              </span>
            )}
          </Button>
        )}
        <Button
          onClick={onToggleTheme}
          className="w-9 shrink-0 px-0"
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </Button>
        {onSignOut && (
          <Button onClick={onSignOut} className="w-9 shrink-0 px-0" aria-label={signOutLabel} title={signOutLabel}>
            <LogOut size={17} />
          </Button>
        )}
      </div>
    </header>
  );
}

/** A button along the right edge of a timer chip. Icon only unless it has `text`, which shows from `sm` up. */
function ChipButton({ edge, onClick, label, text, className = "", children }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 border-l text-xs font-semibold transition-colors hover:bg-surface-2 ${text ? "px-3" : "px-2.5"} ${className}`}
      style={{ borderColor: edge }}
      aria-label={label}
      title={label}
    >
      {children}
      {text && <span className="hidden sm:inline">{text}</span>}
    </button>
  );
}

/** The pomodoro, always there, and next to it the project timer while one runs (or is paused for the break). */
function NowTracking({ project, session, elapsed, heldProject, heldSeconds, onSaveNote, pomodoro, onStop }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <PomodoroChip pomodoro={pomodoro} />
      {project ? (
        <ProjectChip project={project} session={session} elapsed={elapsed} onSaveNote={onSaveNote} onStop={onStop} />
      ) : (
        heldProject && <HeldChip project={heldProject} seconds={heldSeconds} />
      )}
    </div>
  );
}

/** A project timer paused for the break. It starts again with the next focus. */
function HeldChip({ project, seconds }) {
  return (
    <div
      className="relative flex h-[34px] min-w-0 items-center gap-2 border border-dashed pl-3 pr-2.5 text-muted"
      style={{ borderColor: tint(project.color, 55) }}
      title={`${project.name} is paused for the break. It starts again with the next focus.`}
    >
      <Pause size={11} fill="currentColor" className="shrink-0" aria-hidden="true" />
      <span className="hidden max-w-[10rem] truncate font-serif text-[15px] italic lg:block">{project.name}</span>
      <span className="figures whitespace-nowrap text-[15px] font-semibold" role="timer" aria-label={`Time on ${project.name}, paused`}>
        <span className="max-sm:hidden">{fmtClock(seconds)}</span>
        <span className="sm:hidden">{fmtHM(seconds)}</span>
      </span>
    </div>
  );
}

/** The project timer: it counts up while you work on the project, and that time is what gets logged. */
function ProjectChip({ project, session, elapsed, onSaveNote, onStop }) {
  const edge = tint(project.color, 55);
  return (
    <div className="relative flex h-[34px] min-w-0 items-stretch border" style={{ borderColor: edge, background: tint(project.color, 10) }}>
      <div className="flex min-w-0 items-center gap-2 pl-3 pr-2.5">
        <span className="blink-dot size-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
        <span className="hidden max-w-[10rem] truncate font-serif text-[15px] italic lg:block">{project.name}</span>
        <span className="figures whitespace-nowrap text-[15px] font-semibold" role="timer" aria-label={`Time on ${project.name}`}>
          <span className="max-sm:hidden">{fmtClock(elapsed)}</span>
          <span className="sm:hidden">{fmtHM(elapsed)}</span>
        </span>
      </div>
      {session && (
        <div className="flex max-sm:hidden">
          <TimerNote key={session.id} session={session} project={project} edge={edge} onSave={onSaveNote} />
        </div>
      )}
      {/* Phones show only what's running and for how long: its card and the Feed have the Stop button */}
      <ChipButton edge={edge} onClick={onStop} label={`Stop ${project.name} timer`} className="max-sm:hidden">
        <Square size={10} fill="currentColor" />
      </ChipButton>
    </div>
  );
}

/** The pomodoro's own countdown: idle and ready to start, focusing (or paused), or on a break. */
function PomodoroChip({ pomodoro }) {
  const { phase } = pomodoro;
  if (phase === "breakWait" || phase === "break" || phase === "breakPaused" || phase === "ready") {
    return <BreakChip pomodoro={pomodoro} />;
  }
  const focus = phase === "focus";
  const paused = phase === "focusPaused";
  const edge = focus ? "var(--accent)" : "var(--line-strong)";
  return (
    <div
      className="relative flex h-[34px] min-w-0 shrink-0 items-stretch border"
      style={{ borderColor: edge, background: focus ? "color-mix(in srgb, var(--accent) 8%, transparent)" : undefined }}
    >
      <div className="flex min-w-0 items-center gap-2 pl-3 pr-2.5">
        {paused ? (
          <Pause size={13} fill="currentColor" className="shrink-0 text-muted max-sm:hidden" aria-hidden="true" />
        ) : (
          <Timer size={14} className={`shrink-0 max-sm:hidden ${focus ? "text-accent" : "text-muted"}`} aria-hidden="true" />
        )}
        {paused && <span className="hidden text-[13px] font-semibold sm:block">Paused</span>}
        <span
          className={`figures text-[17px] font-semibold ${phase === "idle" ? "text-muted" : ""}`}
          role="timer"
          aria-label={paused ? "Focus time left, paused" : "Focus time left"}
        >
          {fmtCountdown(pomodoro.focusRemaining)}
        </span>
        <span className="figures hidden text-xs text-muted md:block" title="Focus periods in this set">
          {pomodoro.position}/{pomodoro.settings.longEvery}
        </span>
      </div>
      {phase === "idle" && (
        <ChipButton edge={edge} onClick={pomodoro.startFocus} label="Start a focus" text="Focus">
          <Play size={10} fill="currentColor" />
        </ChipButton>
      )}
      {focus && (
        <>
          <ChipButton edge={edge} onClick={pomodoro.pause} label="Pause the focus">
            <Pause size={13} fill="currentColor" />
          </ChipButton>
          {/* Phones keep the chip to pause and stop: the break arrives by itself when the focus ends */}
          <ChipButton edge={edge} onClick={pomodoro.breakNow} label="Take a break now" className="max-sm:hidden">
            <Coffee size={14} />
          </ChipButton>
        </>
      )}
      {paused && (
        <ChipButton edge={edge} onClick={pomodoro.resume} label="Resume the focus" text="Resume">
          <Play size={10} fill="currentColor" />
        </ChipButton>
      )}
      {(focus || paused) && (
        <ChipButton edge={edge} onClick={pomodoro.dismiss} label="Stop the pomodoro">
          <Square size={10} fill="currentColor" />
        </ChipButton>
      )}
      {(focus || paused) && <Progress value={pomodoro.focusProgress} color={focus ? "var(--accent)" : "var(--muted)"} />}
    </div>
  );
}

/** The rest between focus periods: waiting to be started, counting down (or paused), then waiting to be asked back. */
function BreakChip({ pomodoro }) {
  const { phase } = pomodoro;
  const waiting = phase === "breakWait";
  const paused = phase === "breakPaused";
  const ready = phase === "ready";
  const long = pomodoro.breakKind === "long";
  const edge = "var(--accent-2)";
  return (
    <div
      className="relative flex h-[34px] min-w-0 shrink-0 items-stretch border"
      style={{ borderColor: edge, background: "color-mix(in srgb, var(--accent-2) 10%, transparent)" }}
    >
      <div className="flex min-w-0 items-center gap-2 pl-3 pr-2.5">
        <Coffee size={15} className="shrink-0 max-sm:hidden" style={{ color: edge }} aria-hidden="true" />
        {ready ? (
          <span className="truncate text-[13px] font-semibold">Break over</span>
        ) : (
          <>
            <span className="hidden text-[13px] font-semibold sm:block">
              {long ? "Long break" : "Break"}
              {paused && <span className="font-normal text-muted"> · paused</span>}
            </span>
            <span className="figures text-[17px] font-semibold" role="timer" aria-label="Break time left">
              {fmtCountdown(pomodoro.breakRemaining)}
            </span>
          </>
        )}
      </div>
      {waiting && (
        <ChipButton edge={edge} onClick={pomodoro.startBreak} label="Start the break" text="Start break">
          <Play size={10} fill="currentColor" />
        </ChipButton>
      )}
      {phase === "break" && (
        <ChipButton edge={edge} onClick={pomodoro.pauseBreak} label="Pause the break">
          <Pause size={13} fill="currentColor" />
        </ChipButton>
      )}
      {paused && (
        <ChipButton edge={edge} onClick={pomodoro.resumeBreak} label="Resume the break" text="Resume">
          <Play size={10} fill="currentColor" />
        </ChipButton>
      )}
      {/* Starting the next focus: the main button once the break is over, a way out of the break before then */}
      {ready ? (
        <ChipButton edge={edge} onClick={pomodoro.startFocus} label="Start the next focus" text="Focus">
          <Play size={10} fill="currentColor" />
        </ChipButton>
      ) : (
        <ChipButton edge={edge} onClick={pomodoro.startFocus} label="Skip the break and start the next focus" className="max-sm:hidden">
          <SkipForward size={12} fill="currentColor" />
        </ChipButton>
      )}
      <ChipButton edge={edge} onClick={pomodoro.dismiss} label="Stop the break">
        <Square size={10} fill="currentColor" />
      </ChipButton>
      {(phase === "break" || paused) && <Progress value={pomodoro.breakProgress} color={edge} />}
    </div>
  );
}

/** A hairline along the foot of the chip showing how far through the period it is. */
function Progress({ value, color }) {
  return (
    <span
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px]"
      style={{ background: color, transformOrigin: "left", transform: `scaleX(${value})` }}
      aria-hidden="true"
    />
  );
}

/** A note for the session that's running, written whenever you like while the clock is going.
 *  It lands on the same session record that Add time's note does. */
function TimerNote({ session, project, edge, onSave }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(session.note);
  const saved = useRef(session.note);
  const ref = useRef(null);
  const ready = !String(session.id).startsWith("temp-"); // the server hasn't answered yet

  const save = () => {
    const note = draft.trim();
    if (note === saved.current) return;
    saved.current = note;
    onSave(note);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        save();
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        save();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  });

  return (
    <div ref={ref} className="flex">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={!ready}
        className="relative flex items-center border-l px-2.5 transition-colors hover:bg-surface-2 disabled:opacity-50"
        style={{ borderColor: edge }}
        aria-label={session.note ? "Edit the note on this timer" : "Add a note to this timer"}
        aria-expanded={open}
        title={session.note || "Add a note to this timer"}
      >
        <NotebookPen size={14} />
        {session.note && <span className="absolute right-1.5 top-1.5 size-1.5 bg-accent" aria-hidden="true" />}
      </button>

      {open && (
        <div className="fade-in absolute left-1/2 top-full z-40 mt-2 w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 border border-line-strong bg-surface p-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted">
              What are you working on? <span className="font-normal italic">{project.name}</span>
            </span>
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={save}
              maxLength={280}
              rows={3}
              placeholder="Outlined the methods section"
              className="w-full resize-none border border-line-strong bg-transparent p-2 text-[14px] outline-none placeholder:text-faint focus:border-text"
            />
          </label>
          <p className="mt-1.5 text-xs text-faint">Saved when you click away. It stays on the session after you stop.</p>
        </div>
      )}
    </div>
  );
}
