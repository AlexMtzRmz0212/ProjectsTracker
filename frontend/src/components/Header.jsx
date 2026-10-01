import { useEffect, useRef, useState } from "react";
import { Coffee, Inbox, LogOut, Moon, NotebookPen, Play, Plus, Square, Sun, Timer, X } from "lucide-react";
import { Button } from "./Modal";
import { tint } from "../lib/palette";
import { fmtCountdown } from "../lib/time";

export default function Header({
  runningProject, runningSession, onSaveNote, pomodoro, breakProject, onStop, onNewProject, theme, onToggleTheme,
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
            onSaveNote={onSaveNote}
            pomodoro={pomodoro}
            breakProject={breakProject}
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

function NowTracking({ project, session, onSaveNote, pomodoro, breakProject, onStop }) {
  const { phase } = pomodoro;
  if (phase === "break" || phase === "ready") return <BreakChip pomodoro={pomodoro} project={breakProject} />;
  if (!project) {
    return <span className="truncate text-[13px] text-muted">No timer running</span>;
  }

  const edge = tint(project.color, 55);
  return (
    <div className="relative flex h-[34px] min-w-0 items-stretch border" style={{ borderColor: edge, background: tint(project.color, 10) }}>
      <div className="flex min-w-0 items-center gap-2 pl-3 pr-2.5">
        <span className="blink-dot size-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
        <span className="hidden max-w-[12rem] truncate font-serif text-[15px] italic sm:block">{project.name}</span>
        <span className="figures text-[17px] font-semibold" role="timer" aria-label="Focus time left">
          {fmtCountdown(pomodoro.focusRemaining)}
        </span>
        <span className="figures hidden text-xs text-muted md:block" title="Focus periods in this set">
          {pomodoro.position}/{pomodoro.settings.longEvery}
        </span>
      </div>
      {session && <TimerNote key={session.id} session={session} project={project} edge={edge} onSave={onSaveNote} />}
      <button
        onClick={onStop}
        className="flex items-center gap-1.5 border-l px-3 text-xs font-semibold transition-colors hover:bg-surface-2"
        style={{ borderColor: edge }}
        aria-label={`Stop ${project.name} timer`}
      >
        <Square size={10} fill="currentColor" />
        <span className="hidden sm:inline">Stop</span>
      </button>
      <Progress value={pomodoro.focusProgress} color="var(--accent)" />
    </div>
  );
}

/** The rest between focus periods: counting down, then waiting to be asked back. */
function BreakChip({ pomodoro, project }) {
  const ready = pomodoro.phase === "ready";
  const long = pomodoro.breakKind === "long";
  const edge = "var(--accent-2)";
  const side = "flex items-center gap-1.5 border-l px-3 text-xs font-semibold transition-colors hover:bg-surface-2";
  return (
    <div
      className="relative flex h-[34px] min-w-0 items-stretch border"
      style={{ borderColor: edge, background: "color-mix(in srgb, var(--accent-2) 10%, transparent)" }}
    >
      <div className="flex min-w-0 items-center gap-2 pl-3 pr-2.5">
        <Coffee size={15} className="shrink-0" style={{ color: edge }} aria-hidden="true" />
        {ready ? (
          <span className="truncate text-[13px] font-semibold">
            Break over<span className="hidden sm:inline">{project ? <> · <span className="font-serif font-normal italic">{project.name}</span></> : null}</span>
          </span>
        ) : (
          <>
            <span className="hidden text-[13px] font-semibold sm:block">{long ? "Long break" : "Break"}</span>
            {project && (
              <span className="hidden max-w-[12rem] truncate font-serif text-[15px] italic sm:block">{project.name}</span>
            )}
            <span className="figures text-[17px] font-semibold" role="timer" aria-label="Break time left">
              {fmtCountdown(pomodoro.breakRemaining)}
            </span>
          </>
        )}
      </div>
      {project && (
        <button onClick={pomodoro.startNext} className={side} style={{ borderColor: edge }} aria-label={ready ? "Start the next focus" : "Skip the break and start the next focus"}>
          <Play size={10} fill="currentColor" />
          <span className="hidden sm:inline">{ready ? "Start" : "Skip"}</span>
        </button>
      )}
      <button onClick={pomodoro.dismiss} className={`${side} px-2.5`} style={{ borderColor: edge }} aria-label="Dismiss the break">
        <X size={13} />
      </button>
      {!ready && <Progress value={pomodoro.breakProgress} color={edge} />}
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
