import { useMemo, useState } from "react";
import {
  CalendarDays, CalendarPlus, Grid3x3, Hand, LayoutGrid, LockKeyhole, Moon, Play, Presentation, RotateCcw, Sun, Timer,
} from "lucide-react";
import Tracker from "../Tracker";
import { Button } from "../components/Modal";
import TabBar from "../components/TabBar";
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
    icon: LayoutGrid,
    name: "Status board",
    text: "Every status is a column. Drag a project from Idea to Active to Done, and add notes and to-dos to each one.",
  },
  {
    icon: CalendarPlus,
    name: "Manual time",
    text: "Forgot to start the clock? Log time afterwards by typing a duration, including sessions that ran past midnight.",
  },
  {
    icon: CalendarDays,
    name: "Calendar",
    text: "Each day fills with the colors of the projects you worked on, in proportion to the time. Click a day to see its sessions.",
  },
  {
    icon: Grid3x3,
    name: "Heatmap",
    text: "Weeks of work in one strip. Filter it by project, and click a square to jump the calendar there.",
  },
];

const TABS = [
  { id: "demo", label: "Try it", icon: Presentation },
  { id: "how", label: "How it works", short: "How", icon: LayoutGrid },
  { id: "ask", label: "Ask for your own", short: "Ask", icon: Hand },
];

/** One screen with three tabs: the live demo, what it does, and the request for access.
 *  Nothing here is taller than the window unless the window is very small. */
export default function Landing({ interest, onOwner }) {
  const [theme, toggleTheme] = useTheme();
  const [tab, setTab] = useState("demo");
  // Reset swaps in a freshly seeded demo, so people can play without fear
  const [run, setRun] = useState(0);
  const demoApi = useMemo(() => createDemoApi(), [run]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-dvh min-h-[34rem] flex-col">
      <header className="shrink-0 border-b border-line">
        <div className="mx-auto flex h-12 w-full max-w-7xl items-center gap-2 px-3 sm:gap-4 sm:px-6">
          <div className="flex shrink-0 items-center gap-2">
            <Timer size={20} aria-hidden="true" />
            <span className="hidden font-serif text-lg font-semibold tracking-tight md:block">ProjectsTracker</span>
          </div>
          <TabBar tabs={TABS} value={tab} onChange={setTab} label="Sections" bare className="min-w-0 flex-1 justify-center sm:justify-start" />
          <div className="flex shrink-0 items-center">
            <Button onClick={toggleTheme} className="w-9 px-0" aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </Button>
            <button
              onClick={onOwner}
              aria-label="Owner sign in"
              className="grid size-8 shrink-0 place-items-center text-faint transition-colors hover:bg-surface-2 hover:text-text"
            >
              <LockKeyhole size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* The demo stays mounted behind the other tabs, so coming back finds it as you left it */}
      <main className="flex min-h-0 flex-1 flex-col">
        <section
          role="tabpanel"
          id="panel-demo"
          aria-labelledby="tab-demo"
          hidden={tab !== "demo"}
          className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-3 pt-3 sm:px-6 sm:pb-5 sm:pt-4"
        >
          <div className="flex shrink-0 items-end gap-4 max-sm:px-3">
            <div className="min-w-0 flex-1 border-l-[3px] border-double border-margin pl-3 sm:pl-5">
              <h1 className="text-balance font-serif text-xl font-semibold leading-tight tracking-tight sm:text-3xl">
                Know where your hours go.
              </h1>
              <p className="mt-1 hidden max-w-2xl text-[13px] text-muted sm:block [@media(max-height:820px)]:hidden">
                One-click timers for each project, a board for where each one stands, a calendar that fills as you work,
                and a year of effort at a glance.
              </p>
            </div>
            <p className="hidden max-w-[16rem] text-right text-xs text-muted xl:block">
              Live demo on sample data. Drag a project to a new status, press a timer, or open a project. Nothing is saved.
            </p>
            <Button onClick={() => setRun((n) => n + 1)} className="h-8 shrink-0 px-2.5 text-xs">
              <RotateCcw size={13} /> Reset demo
            </Button>
          </div>

          <div className="min-h-0 flex-1 border-y border-line-strong bg-bg sm:border" aria-label="Live demo">
            <Tracker key={run} api={demoApi} demo />
          </div>
        </section>

        {tab === "how" && (
          <section
            role="tabpanel"
            id="panel-how"
            aria-labelledby="tab-how"
            className="mx-auto w-full max-w-7xl flex-1 overflow-y-auto px-4 py-8 sm:px-6 lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-14 lg:py-12"
          >
            <div className="mb-6 lg:mb-0">
              <h2 className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl">How it works</h2>
              <p className="mt-3 max-w-sm text-[13px] text-muted">
                Everything in the demo is the real interface. Only the data is made up.
              </p>
              <p className="mt-6 hidden text-[13px] text-faint lg:block">
                Built with React, Vite, Tailwind, FastAPI and PostgreSQL.
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
            <p className="mt-6 text-[13px] text-faint lg:hidden">Built with React, Vite, Tailwind, FastAPI and PostgreSQL.</p>
          </section>
        )}

        {tab === "ask" && (
          <section role="tabpanel" id="panel-ask" aria-labelledby="tab-ask" className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-14 lg:py-12">
              <div>
                <h2 className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl">Ask for your own</h2>
                <p className="mt-3 max-w-md text-base text-muted">
                  The real tracker is private for now. If you'd use it, press the button. Every press shows it's worth
                  opening up.
                </p>
              </div>
              <InterestWidget interest={interest} />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
