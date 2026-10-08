import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GripHorizontal, MoveDiagonal2, Search, X } from "lucide-react";
import { ActionButton, controlsFor, phaseView } from "./PomodoroScreen";
import { matchProjects } from "./ProjectSearch";
import { iconFor, inkText, tint } from "../lib/palette";
import { fmtClock, fmtCountdown } from "../lib/time";

const POS_KEY = "pt-mini-pos";
const SIZE_KEY = "pt-mini-size";
const MARGIN = 8;
const BAR = 24; // the widget's drag bar
const SIZE = { w: 360, h: 204 }; // the widget's first size, drag bar included
const MIN = { w: 160, h: 96 };
const MAX = { w: 640, h: 720 };

function readSaved(key, fallback, fields) {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (fields.every((f) => Number.isFinite(saved?.[f]))) return saved;
  } catch {
    // nothing saved, or storage blocked
  }
  return fallback;
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked: it just won't survive a reload
  }
}

/**
 * The pomodoro as a mini clock, laid out like Spotify's mini player: drawn into the floating window when
 * there is one (`pip`), otherwise as a small widget over the page that can be dragged by its top edge,
 * resized from its top-left corner, and remembers both. What it shows follows the shape it is given (see
 * ClockFace). Ctrl+F (⌘F) inside it finds an open project to work on (`onPickProject`).
 * `hidden` keeps the widget away while the full screen is up; a floating window is left alone.
 */
export default function MiniPlayer({ pip, hidden = false, onClose, ...rest }) {
  const clockFace = <MiniClock {...rest} />;
  if (pip) return createPortal(<div className="h-dvh overflow-hidden bg-bg text-text">{clockFace}</div>, pip.document.body);
  if (hidden) return null;
  return <Floating onClose={onClose}>{clockFace}</Floating>;
}

/** The size of an element, kept up to date. The observer comes from the element's own window, so it also
 *  works in the floating window. */
function useBox(ref) {
  const [box, setBox] = useState({ w: SIZE.w, h: SIZE.h - BAR });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const Observer = el.ownerDocument.defaultView?.ResizeObserver ?? ResizeObserver;
    const observer = new Observer(([entry]) => setBox({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return box;
}

const clampNum = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
// Five tabular figures ("25:00") are about this many ems wide; eight ("01:23:45") about five
const COUNTDOWN_EM = 3.1;
const CLOCK_EM = 5;
const isFind = (e) => (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f";

/** Measures itself, and takes Ctrl+F: in the floating window from anywhere in it, on the page while the
 *  focus is inside the widget (the page's own Ctrl+F is left alone otherwise). */
function MiniClock(props) {
  const ref = useRef(null);
  const { w, h } = useBox(ref);
  const [searching, setSearching] = useState(false);
  const canSearch = Boolean(props.onPickProject) && props.projects?.length > 0;

  useEffect(() => {
    const doc = ref.current?.ownerDocument;
    if (!canSearch || !doc || doc === document) return;
    const onKey = (e) => {
      if (!isFind(e)) return;
      e.preventDefault();
      setSearching(true);
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  }, [canSearch]);

  return (
    <div
      ref={ref}
      className="relative h-full"
      onKeyDown={(e) => {
        if (!canSearch || !isFind(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setSearching(true);
      }}
    >
      <ClockFace w={w} h={h} {...props} onSearch={canSearch ? () => setSearching(true) : undefined} />
      {searching && (
        <MiniSearch
          projects={props.projects}
          runningId={props.runningProject?.id}
          onClose={() => setSearching(false)}
          onPick={(id) => {
            setSearching(false);
            props.onPickProject(id);
          }}
        />
      )}
    </div>
  );
}

/**
 * The clock, laid out for the shape it has, the way Spotify's mini player does it:
 * - tiny: the time passing and the project over a wash of the phase's color; buttons on hover;
 * - strip (short and wide): a tile with the hourglass (the "cover"), the time and the project beside it,
 *   the buttons at the end if they fit (on hover if not), the progress along the bottom edge;
 * - wide: the tile filling the height, and beside it the phase, the time, the project, the progress and
 *   the buttons, then the project's open to-dos when there is room under them;
 * - square: the hourglass and the time filling the window, the phase across the top, the project along the
 *   bottom, the buttons sliding up over it on hover; tall enough, the buttons stay out under it and
 *   the to-dos fill the rest.
 */
function ClockFace({ w, h, pomodoro, runningProject, clock, heldProject, heldSeconds, todos = [], todoOps, timedTodoId = null, onStopFocus, onSearch }) {
  const view = phaseView(pomodoro);
  const idle = view.tone === "idle";
  const flowing = pomodoro.phase === "focus" || pomodoro.phase === "break";
  // With no pomodoro going, the time passing is the project timer's
  const projectClock = pomodoro.phase === "idle" && Boolean(runningProject);
  const project = runningProject ?? heldProject;
  const [reveal, setReveal] = useState(false); // buttons shown by a tap, where there is no hover
  // The mouse over the clock. Followed with pointer events rather than CSS :hover, which the floating
  // window doesn't always apply (the buttons stayed out of reach there)
  const [hovered, setHovered] = useState(false);

  const big = {
    text: projectClock ? fmtClock(clock) : fmtCountdown(view.remaining),
    em: projectClock ? CLOCK_EM : COUNTDOWN_EM,
    label: projectClock ? `Time on ${runningProject.name}` : view.timerLabel,
    color: projectClock ? "var(--text)" : idle ? "var(--muted)" : view.color,
  };
  const label = projectClock ? "Timer running" : view.label;
  const projectTime = project && !projectClock ? fmtClock(runningProject ? clock : heldSeconds) : null;
  const controls = controlsFor(pomodoro, pomodoro.startFocus, onStopFocus, Boolean(runningProject));
  const controlsW = controls.length * 40 + (onSearch ? 40 : 0);
  const wash = `linear-gradient(140deg, ${tint(big.color, 20)}, ${tint(big.color, 4)} 65%)`;
  // What is left to do on what's being worked on, the to-dos marked as being worked on first. A task is its
  // own to-do: it is listed so it can be ticked off from here.
  const open = !project
    ? []
    : project.kind === "task"
      ? todos.filter((x) => x.id === project.todoId && !x.done)
      : todos
          .filter((x) => x.project_id === project.id && !x.done)
          .sort(
            (a, b) =>
              (b.id === timedTodoId) - (a.id === timedTodoId) || Boolean(b.working_since) - Boolean(a.working_since)
          );

  const fit = (width, height, em = big.em) => clampNum(Math.min(width / em, height * 0.92), 12, 160);
  const digits = (fontSize, className = "") => (
    <p
      className={`figures whitespace-nowrap font-semibold leading-none tracking-tight ${className}`}
      style={{ fontSize, color: big.color }}
      role="timer"
      aria-label={big.label}
    >
      {big.text}
    </p>
  );
  const glass = (height) => <Hourglass height={height} progress={view.progress} color={view.color} flowing={flowing} />;
  const buttons = <Controls controls={controls} onSearch={onSearch} />;
  const hover = (className) => (
    <HoverLayer shown={reveal || hovered} className={className}>
      {buttons}
    </HoverLayer>
  );
  // The mouse brings the buttons up while it is over the clock; a tap brings them up, or puts them away
  const tapToReveal = {
    onPointerMove: (e) => e.pointerType === "mouse" && !hovered && setHovered(true),
    onPointerLeave: (e) => e.pointerType === "mouse" && setHovered(false),
    onPointerUp: (e) => {
      if (e.pointerType === "mouse" || (e.target instanceof Element && e.target.closest("button, input"))) return;
      setReveal((r) => !r);
    },
  };

  const layout = h < 84 || w < 190 ? "tiny" : h < 140 ? "strip" : w / h >= 1.3 ? "wide" : "square";

  if (layout === "tiny") {
    const glassH = Math.min(h - 16, 72);
    const withGlass = w >= 130 && glassH >= 26;
    const withProject = Boolean(project) && h >= 62;
    return (
      <div className="group relative flex h-full items-center gap-2.5 px-2.5" style={{ background: wash }} title={label} {...tapToReveal}>
        {withGlass && glass(glassH)}
        <div className="min-w-0 flex-1">
          {digits(fit(w - 20 - (withGlass ? glassH * 0.6 + 10 : 0), h - 14 - (withProject ? 20 : 0)))}
          {withProject && <ProjectLine project={project} className="mt-1.5" />}
        </div>
        <ProgressBar progress={view.progress} color={view.color} className="absolute inset-x-0 bottom-0" />
        {hover("inset-0 justify-center bg-bg/85")}
      </div>
    );
  }

  // The phase and set position on the countdown's own line, ruled off from it: 25:00 ── Focus ── 2/4
  const phaseReserve = (room) => clampNum(label.length * 7.5 + 76, 120, room * 0.5);
  const phaseLine = <PhaseRule label={label} pomodoro={pomodoro} color={idle ? undefined : view.color} />;

  if (layout === "strip") {
    const glassH = h - 22;
    const inline = w - glassH * 0.6 - 36 - controlsW >= 170;
    const textW = w - 20 - glassH * 0.6 - 12 - (inline ? controlsW + 12 : 0);
    const besideLabel = textW - phaseReserve(textW) >= 96;
    const aboveLabel = !besideLabel && h >= 112;
    const digitsH = glassH - (project ? 22 : 0) - (aboveLabel ? 22 : 0);
    return (
      <div className="group relative flex h-full items-center gap-3 px-2.5 pt-2.5 pb-3" style={{ background: wash }} {...tapToReveal}>
        {glass(glassH)}
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          {aboveLabel && <PhaseLabel label={label} pomodoro={pomodoro} color={idle ? undefined : view.color} />}
          {besideLabel ? (
            <div className="flex min-w-0 items-center gap-3">
              {digits(fit(textW - phaseReserve(textW) - 12, digitsH))}
              {phaseLine}
            </div>
          ) : (
            digits(fit(textW, digitsH))
          )}
          {project && <ProjectLine project={project} time={projectTime} running={Boolean(runningProject)} />}
        </div>
        {inline && <div className="shrink-0">{buttons}</div>}
        <ProgressBar progress={view.progress} color={view.color} className="absolute inset-x-0 bottom-0" />
        {!inline && hover("inset-0 justify-end bg-bg/85 pr-3")}
      </div>
    );
  }

  if (layout === "wide") {
    const glassH = Math.min(h - 24, (w * 0.3) / 0.6);
    const colW = w - 24 - glassH * 0.6 - 16;
    const free = h - 24 - (20 + 3 + 36 + 3 * 8);
    const withTodos = free >= 150 && colW >= 170;
    const bigH = withTodos ? clampNum(free * 0.32, 40, 110) : free;
    const besideLabel = colW - phaseReserve(colW) >= 110;
    return (
      <div className="flex h-full gap-4 p-3" style={{ background: wash }}>
        <div className="grid shrink-0 place-items-center">{glass(glassH)}</div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
          {!besideLabel && <PhaseLabel label={label} pomodoro={pomodoro} color={idle ? undefined : view.color} />}
          <div className="flex min-w-0 shrink-0 items-center gap-3" style={{ height: besideLabel ? bigH : bigH - 26 }}>
            {besideLabel ? (
              <>
                {digits(fit(colW - phaseReserve(colW) - 12, bigH))}
                {phaseLine}
              </>
            ) : (
              digits(fit(colW, bigH - 26))
            )}
          </div>
          <div className="flex h-5 shrink-0 items-center">
            {project ? (
              <ProjectLine project={project} time={projectTime} running={Boolean(runningProject)} className="flex-1" />
            ) : (
              <span className="font-serif text-xs italic text-faint">No project timer</span>
            )}
          </div>
          <ProgressBar progress={view.progress} color={view.color} />
          {buttons}
          {withTodos && <TodoList project={project} open={open} todoOps={todoOps} />}
        </div>
      </div>
    );
  }

  // Square, or tall: the cover is the whole window, or the top of it with the buttons and to-dos under it
  const tall = h >= w * 1.25 && h >= 300;
  const artH = tall ? clampNum(w * 0.8, 150, h * 0.55) : h;
  const midH = artH - 20 - 18 - 22 - 16;
  const side = w >= midH * 1.1;
  const glassH = side ? Math.min(midH * 0.92, ((w - 20) * 0.3) / 0.6) : midH * 0.48;
  const fontSize = side ? fit(w - 20 - glassH * 0.6 - 14, midH) : fit(w - 20, midH * 0.42);
  return (
    <div className="flex h-full flex-col">
      <div
        className="group relative flex shrink-0 flex-col justify-between gap-2 px-2.5 pt-2.5 pb-3"
        style={{ height: artH, background: wash }}
        {...tapToReveal}
      >
        <PhaseLabel label={label} pomodoro={pomodoro} color={idle ? undefined : view.color} />
        <div className={`flex min-h-0 flex-1 items-center justify-center ${side ? "gap-3.5" : "flex-col gap-2"}`}>
          {glass(glassH)}
          {digits(fontSize)}
        </div>
        <div className="flex h-[22px] shrink-0 items-center">
          {project ? (
            <ProjectLine project={project} time={projectTime} running={Boolean(runningProject)} className="flex-1" />
          ) : (
            <span className="font-serif text-xs italic text-faint">No project timer</span>
          )}
        </div>
        <ProgressBar progress={view.progress} color={view.color} className="absolute inset-x-0 bottom-0" />
        {!tall && hover("inset-x-0 bottom-0 h-14 justify-center bg-linear-to-t from-bg via-bg/90 to-transparent pt-2")}
      </div>
      {tall && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-2.5">
          <div className="flex justify-center">{buttons}</div>
          <TodoList project={project} open={open} todoOps={todoOps} />
        </div>
      )}
    </div>
  );
}

/** The phase and the set position ruled off along the countdown's line: ── Focus ── 2/4 */
function PhaseRule({ label, pomodoro, color }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2" aria-label={`${label}, focus ${pomodoro.position} of ${pomodoro.settings.longEvery}`}>
      <span className="h-px min-w-3 flex-1 bg-line-strong" aria-hidden="true" />
      <span className="min-w-0 truncate font-serif text-sm font-semibold italic" style={{ color }}>
        {label}
      </span>
      <span className="h-px min-w-3 flex-1 bg-line-strong" aria-hidden="true" />
      <span className="figures shrink-0 text-xs text-muted" title="Focus periods in this set">
        {pomodoro.position}/{pomodoro.settings.longEvery}
      </span>
    </div>
  );
}

function PhaseLabel({ label, pomodoro, color }) {
  return (
    <div className="flex h-[18px] shrink-0 items-baseline justify-between gap-2">
      <span className="min-w-0 truncate font-serif text-sm font-semibold italic" style={{ color }}>
        {label}
      </span>
      <span className="figures shrink-0 text-xs text-muted" title="Focus periods in this set">
        {pomodoro.position}/{pomodoro.settings.longEvery}
      </span>
    </div>
  );
}

function ProjectLine({ project, time, running, className = "" }) {
  if (!project) return null;
  const Icon = iconFor(project.icon);
  return (
    <span className={`flex min-w-0 items-center gap-1.5 text-[13px] ${className}`}>
      <Icon size={14} style={{ color: inkText(project.color) }} className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate font-serif italic">{project.name}</span>
      {time && (
        <span
          className={`figures shrink-0 font-semibold ${running ? "" : "text-muted"}`}
          role="timer"
          aria-label={`Time on ${project.name}${running ? "" : ", paused"}`}
        >
          {time}
        </span>
      )}
    </span>
  );
}

function ProgressBar({ progress, color, className = "" }) {
  return (
    <div className={`h-[3px] shrink-0 bg-line ${className}`} aria-hidden="true">
      <div className="h-full origin-left" style={{ background: color, transform: `scaleX(${progress})` }} />
    </div>
  );
}

function Controls({ controls, onSearch }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {controls.map((c) => (
        <ActionButton key={c.id} {...c} compact />
      ))}
      {onSearch && (
        <button
          onClick={onSearch}
          className="grid size-9 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
          aria-label="Find a project"
          title="Find a project (Ctrl F)"
        >
          <Search size={14} />
        </button>
      )}
    </div>
  );
}

/** Buttons that come up over the clock while the mouse is on it (or after a tap, or with the keyboard
 *  focus in them), as Spotify's do over the cover. */
function HoverLayer({ shown, className, children }) {
  return (
    <div
      className={`absolute flex items-center transition-opacity duration-150 focus-within:pointer-events-auto focus-within:opacity-100 ${
        shown ? "opacity-100" : "pointer-events-none opacity-0"
      } ${className}`}
    >
      {children}
    </div>
  );
}

function TodoList({ project, open, todoOps }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col border-t border-line pt-2" aria-label="To-dos">
      <h2 className="flex shrink-0 items-baseline gap-1.5 font-serif text-xs italic text-muted">
        To-dos {open.length > 0 && <span className="figures not-italic">{open.length}</span>}
      </h2>
      {!project ? (
        <p className="mt-1 text-xs text-faint">Start a project to see its to-dos here.</p>
      ) : open.length === 0 ? (
        <p className="mt-1 text-xs text-faint">Nothing left to do on {project.name}.</p>
      ) : (
        <ul className="mt-1 min-h-0 flex-1 overflow-y-auto">
          {open.map((x) => (
            <li key={x.id} className="flex min-h-8 items-center gap-2 border-b border-rule text-[13px]">
              <input
                type="checkbox"
                checked={false}
                onChange={() => todoOps?.update(x.id, { done: true })}
                aria-label={`Mark "${x.text}" done`}
                className="size-4 shrink-0 cursor-pointer accent-(--text)"
              />
              <span className={`min-w-0 flex-1 truncate ${x.parent_id ? "pl-3 text-muted" : ""}`} title={x.text}>
                {x.text}
              </span>
              {x.id === timedTodoId ? (
                <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-accent" title="The timer is on this">
                  <span className="blink-dot size-1.5 rounded-full bg-accent" aria-hidden="true" />
                  Timing
                </span>
              ) : x.working_since && (
                <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-accent" title="Working on this">
                  <span className="blink-dot size-1.5 rounded-full bg-accent" aria-hidden="true" />
                  Working on
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Find an open project by name inside the mini clock: type, arrows, Enter starts it; Esc goes back. */
function MiniSearch({ projects, runningId, onPick, onClose }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const results = useMemo(() => matchProjects(projects, query), [projects, query]);
  const current = Math.min(active, results.length - 1);

  useEffect(() => {
    listRef.current?.children[current]?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length) setActive((current + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[current]) onPick(results[current].id);
    } else if (isFind(e)) {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.select();
    }
  };

  return (
    <div className="fade-in absolute inset-0 z-20 flex flex-col bg-bg" role="dialog" aria-label="Find a project">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line-strong pl-2.5">
        <Search size={14} className="shrink-0 text-muted" aria-hidden="true" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-label="Project name"
          placeholder="Find a project"
          autoComplete="off"
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
        />
        <button
          onClick={onClose}
          className="grid h-full w-9 shrink-0 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
          aria-label="Close the search"
        >
          <X size={14} />
        </button>
      </div>
      {results.length === 0 ? (
        <p className="p-3 font-serif text-xs italic text-muted">No project matches “{query.trim()}”.</p>
      ) : (
        <ul ref={listRef} role="listbox" className="min-h-0 flex-1 overflow-y-auto">
          {results.map((p, i) => {
            const Icon = iconFor(p.icon);
            return (
              <li
                key={p.id}
                role="option"
                aria-selected={i === current}
                onClick={() => onPick(p.id)}
                onMouseMove={() => i !== current && setActive(i)}
                className={`flex h-8 cursor-pointer items-center gap-2 border-b border-rule px-2.5 text-[13px] ${i === current ? "bg-surface-2" : ""}`}
              >
                <Icon size={14} style={{ color: inkText(p.color) }} className="shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-serif">{p.name}</span>
                {p.id === runningId && <span className="blink-dot size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// The glass: two bulbs meeting at a neck at y=50, between a cap and a base
const GLASS = "M9 7 C9 31 27 42 28.5 50 C27 58 9 69 9 93 L51 93 C51 69 33 58 31.5 50 C33 42 51 31 51 7 Z";

/** An hourglass for how far through the period it is: the top bulb empties into the bottom one as
 *  `progress` goes from 0 to 1, with a thread of sand running through the neck while the clock runs. */
export function Hourglass({ height, progress, color, flowing }) {
  const clip = `hg-${useId().replace(/[^\w-]/g, "")}`;
  const left = 1 - progress;
  const top = 50 - left * 40; // the sand's surface in the top bulb
  const mound = 93 - progress * 38; // the top of the pile in the bottom one
  return (
    <svg viewBox="0 0 60 100" className="shrink-0 text-muted" style={{ height, width: height * 0.6 }} aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <path d={GLASS} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        {left > 0.005 && <rect x="0" y={top} width="60" height={50 - top} fill={color} opacity="0.85" />}
        {progress > 0.005 && <path d={`M0 100 L0 ${mound + 7} Q30 ${mound - 7} 60 ${mound + 7} L60 100 Z`} fill={color} opacity="0.85" />}
        {flowing && left > 0.005 && (
          <line x1="30" y1="49" x2="30" y2={Math.max(mound - 2, 52)} stroke={color} strokeWidth="1.8" className="sand-stream" />
        )}
      </g>
      <path d={GLASS} fill="none" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.6" />
      <rect x="3" y="2" width="54" height="5" fill="currentColor" />
      <rect x="3" y="93" width="54" height="5" fill="currentColor" />
    </svg>
  );
}

/** The in-page widget: fixed to the window, pinned by its right and bottom edges so it stays put when
 *  the window is resized, dragged by the bar along its top and resized from the grip at its top-left. */
function Floating({ onClose, children }) {
  const [pos, setPos] = useState(() => readSaved(POS_KEY, { right: 16, bottom: 16 }, ["right", "bottom"]));
  const [size, setSize] = useState(() => readSaved(SIZE_KEY, SIZE, ["w", "h"]));
  const drag = useRef(null);

  const clampSize = ({ w, h }) => ({
    w: clampNum(w, MIN.w, Math.max(MIN.w, Math.min(MAX.w, window.innerWidth - 2 * MARGIN))),
    h: clampNum(h, MIN.h, Math.max(MIN.h, Math.min(MAX.h, window.innerHeight - 2 * MARGIN))),
  });
  const shownSize = clampSize(size);
  const clampPos = ({ right, bottom }) => ({
    right: clampNum(right, MARGIN, Math.max(MARGIN, window.innerWidth - shownSize.w - MARGIN)),
    bottom: clampNum(bottom, MARGIN, Math.max(MARGIN, window.innerHeight - shownSize.h - MARGIN)),
  });
  const shown = clampPos(pos);

  /** Pointer handlers that follow a drag: `move(dx, dy, from)` gives the new state, `done(last)` keeps it. */
  const dragging = (start, move, done) => {
    const handlers = {
      onPointerDown: (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        drag.current = { x: e.clientX, y: e.clientY, from: start(), to: null };
        e.currentTarget.setPointerCapture(e.pointerId);
      },
      onPointerMove: (e) => {
        const d = drag.current;
        if (!d) return;
        d.to = move(e.clientX - d.x, e.clientY - d.y, d.from);
      },
      onPointerUp: () => {
        const d = drag.current;
        drag.current = null;
        if (d?.to) done(d.to);
      },
    };
    handlers.onPointerCancel = handlers.onPointerUp;
    return handlers;
  };

  const moveHandle = dragging(
    () => shown,
    (dx, dy, from) => {
      const to = clampPos({ right: from.right - dx, bottom: from.bottom - dy });
      setPos(to);
      return to;
    },
    (to) => save(POS_KEY, to)
  );
  // Pinned by the right and bottom edges, the top-left corner is the one that moves
  const resizeHandle = dragging(
    () => shownSize,
    (dx, dy, from) => {
      const to = clampSize({ w: from.w - dx, h: from.h - dy });
      setSize(to);
      return to;
    },
    (to) => save(SIZE_KEY, to)
  );

  return (
    <aside
      aria-label="Mini clock"
      className="fixed z-[41] flex flex-col border border-line-strong bg-bg shadow-[0_6px_24px_rgb(0_0_0/0.25)]"
      style={{
        right: shown.right,
        bottom: `calc(${shown.bottom}px + var(--bottom-bar, 0px))`,
        width: shownSize.w,
        height: `min(${shownSize.h}px, calc(100dvh - var(--bottom-bar, 0px) - ${2 * MARGIN}px))`,
      }}
    >
      <div className="flex shrink-0 items-center border-b border-line bg-surface" style={{ height: BAR }}>
        <button
          {...resizeHandle}
          className="grid h-full w-7 cursor-nwse-resize touch-none place-items-center text-faint transition-colors hover:text-text"
          aria-label="Resize the mini clock"
          title="Drag to resize"
        >
          <MoveDiagonal2 size={12} aria-hidden="true" />
        </button>
        <button
          {...moveHandle}
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
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </aside>
  );
}
