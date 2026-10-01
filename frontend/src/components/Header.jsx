import { Moon, Plus, Square, Sun, Timer } from "lucide-react";
import { Button } from "./Modal";
import { tint } from "../lib/palette";
import { fmtClock } from "../lib/time";

export default function Header({ runningProject, elapsed, onStop, onNewProject, theme, onToggleTheme }) {
  return (
    <header className="sticky top-0 z-30 border-b-[3px] border-double border-line-strong bg-bg">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:h-16 sm:gap-3 sm:px-6">
        <div className="flex shrink-0 items-center gap-2">
          <Timer size={20} className="text-text" aria-hidden="true" />
          <span className="hidden font-serif text-lg font-semibold tracking-tight sm:block">ProjectsTracker</span>
        </div>

        <div className="flex min-w-0 flex-1 justify-center">
          <NowTracking project={runningProject} elapsed={elapsed} onStop={onStop} />
        </div>

        <Button variant="outline" onClick={onNewProject} className="shrink-0 px-2.5 sm:px-3.5" aria-label="New project">
          <Plus size={16} strokeWidth={2.5} />
          <span className="hidden md:inline">New project</span>
        </Button>
        <Button
          onClick={onToggleTheme}
          className="w-9 shrink-0 px-0"
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </Button>
      </div>
    </header>
  );
}

function NowTracking({ project, elapsed, onStop }) {
  if (!project) {
    return <span className="truncate text-[13px] text-muted">No timer running</span>;
  }

  const edge = tint(project.color, 55);
  return (
    <div className="flex h-[34px] min-w-0 items-stretch border" style={{ borderColor: edge, background: tint(project.color, 10) }}>
      <div className="flex min-w-0 items-center gap-2 pl-3 pr-2.5">
        <span className="blink-dot size-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
        <span className="hidden max-w-[12rem] truncate font-serif text-[15px] italic sm:block">{project.name}</span>
        <span className="figures text-[17px] font-semibold">{fmtClock(elapsed)}</span>
      </div>
      <button
        onClick={onStop}
        className="flex items-center gap-1.5 border-l px-3 text-xs font-semibold transition-colors hover:bg-surface-2"
        style={{ borderColor: edge }}
        aria-label={`Stop ${project.name} timer`}
      >
        <Square size={10} fill="currentColor" />
        <span className="hidden sm:inline">Stop</span>
      </button>
    </div>
  );
}
