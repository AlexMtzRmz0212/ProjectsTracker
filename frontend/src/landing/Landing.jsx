import { useMemo, useState } from "react";
import { CalendarDays, CalendarPlus, Grid3x3, LockKeyhole, Moon, Play, RotateCcw, Sun, Timer } from "lucide-react";
import Tracker from "../Tracker";
import { Button } from "../components/Modal";
import { useTheme } from "../hooks/useTheme";
import { createDemoApi } from "../demo/demoApi";
import InterestWidget from "./InterestWidget";

const FEATURES = [
  {
    icon: Play,
    name: "Timers",
    text: "Press play on a project. One timer runs at a time, and in the real app it keeps counting after you close the tab.",
  },
  {
    icon: CalendarPlus,
    name: "Manual time",
    text: "Forgot to start the clock? Log time afterwards, including sessions that ran past midnight.",
  },
  {
    icon: CalendarDays,
    name: "Calendar",
    text: "Each day fills with the colors of the projects you worked on, in proportion to the time. Click a day to see its sessions.",
  },
  {
    icon: Grid3x3,
    name: "Heatmap",
    text: "Fifty-three weeks of work in one strip. Filter it by project, and click a square to jump the calendar there.",
  },
];

function scrollToDemo() {
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById("demo")?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
}

export default function Landing({ interest, onOwner }) {
  const [theme, toggleTheme] = useTheme();
  // Reset swaps in a freshly seeded demo, so people can play without fear
  const [run, setRun] = useState(0);
  const demoApi = useMemo(() => createDemoApi(), [run]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-[100dvh]">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-2">
          <Timer size={20} aria-hidden="true" />
          <span className="font-serif text-lg font-semibold tracking-tight">ProjectsTracker</span>
        </div>
        <Button
          onClick={toggleTheme}
          className="w-9 px-0"
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </Button>
      </div>

      <main>
        <section className="mx-auto max-w-7xl px-4 pb-10 pt-8 sm:px-6 sm:pb-12 sm:pt-12">
          <div className="border-l-[3px] border-double border-margin pl-5 sm:pl-7">
            <h1 className="max-w-3xl text-balance font-serif text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              Know where your hours go.
            </h1>
            <p className="mt-4 max-w-xl text-base text-muted">
              One-click timers for each project, a calendar that fills as you work, and a year of effort at a glance.
            </p>
            <Button variant="primary" onClick={scrollToDemo} className="mt-6 h-11 px-5">
              Try the demo
            </Button>
          </div>
        </section>

        <section id="demo" className="mx-auto max-w-7xl scroll-mt-4 sm:px-6" aria-label="Live demo">
          <div className="border-y border-line-strong bg-bg sm:border">
            <div className="flex items-center gap-3 border-b border-line bg-surface py-1.5 pl-4 pr-2 text-[13px]">
              <p className="min-w-0 flex-1 truncate text-muted">
                <span className="sm:hidden">Live demo on sample data</span>
                <span className="max-sm:hidden">
                  Live demo on sample data. Press a timer, add time, or click a day. Nothing is saved.
                </span>
              </p>
              <Button onClick={() => setRun((n) => n + 1)} className="h-7 shrink-0 px-2.5 text-xs">
                <RotateCcw size={13} /> Reset
              </Button>
            </div>
            <Tracker key={run} api={demoApi} demo />
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20 lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-14">
          <div className="mb-8 lg:mb-0">
            <h2 className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl">How it works</h2>
            <p className="mt-3 max-w-sm text-[13px] text-muted">
              Everything in the demo above is the real interface. Only the data is made up.
            </p>
          </div>
          <ul className="border-t border-rule">
            {FEATURES.map(({ icon: Icon, name, text }) => (
              <li
                key={name}
                className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-4 border-b border-rule sm:grid-cols-[2rem_9rem_minmax(0,1fr)]"
              >
                <span className="row-span-2 flex items-center justify-center self-stretch border-r-[3px] border-double border-margin sm:row-span-1">
                  <Icon size={16} strokeWidth={2.25} aria-hidden="true" />
                </span>
                <h3 className="pt-3 font-serif text-[15px] font-medium sm:py-3">{name}</h3>
                <p className="pb-3 text-[13px] text-muted sm:py-3.5">{text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="border-y-[3px] border-double border-line-strong bg-surface" aria-labelledby="ask">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-14">
            <div>
              <h2 id="ask" className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl">
                Ask for your own
              </h2>
              <p className="mt-3 max-w-md text-base text-muted">
                The real tracker is private for now. If you'd use it, press the button. Every press shows it's worth
                opening up.
              </p>
            </div>
            <InterestWidget interest={interest} />
          </div>
        </section>
      </main>

      <footer>
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
          <p className="text-[13px] text-muted">Built with React, Vite, Tailwind, FastAPI and PostgreSQL.</p>
          <button
            onClick={onOwner}
            aria-label="Owner sign in"
            className="grid size-8 shrink-0 place-items-center text-faint transition-colors hover:bg-surface-2 hover:text-text"
          >
            <LockKeyhole size={14} />
          </button>
        </div>
      </footer>
    </div>
  );
}
