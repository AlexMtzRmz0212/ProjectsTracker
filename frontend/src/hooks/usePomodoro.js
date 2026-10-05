import { useCallback, useEffect, useRef, useState } from "react";
import { useNow } from "./useNow";
import { MIN_TIMER_SECONDS, dayKey, sessionSeconds } from "../lib/time";

export const DEFAULTS = {
  focus: 25, shortBreak: 5, longBreak: 15, longEvery: 4, autoBreak: false, autoStart: false, sound: true,
};
export const LIMITS = { focus: [1, 180], shortBreak: [1, 60], longBreak: [1, 120], longEvery: [2, 12] };

const SETTINGS_KEY = "pt-pomodoro";
const CYCLE_KEY = "pt-pomodoro-cycle";
const IDLE = { day: "", done: 0, phase: "idle", kind: "short", until: 0, left: 0, startedAt: 0, pausedAt: 0, held: null, carry: 0, carryId: null };
const PHASES = ["idle", "focus", "focusPaused", "breakWait", "break", "breakPaused", "ready"];

const clamp = (n, [lo, hi]) => Math.min(hi, Math.max(lo, Math.round(n)));

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? {};
  } catch {
    return {};
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked: it just won't survive a reload
  }
}

/** The saved cycle. One from before the pomodoro had its own clock (a focus that was a
 *  project session) can't be picked up again, so it starts over idle, keeping the day's count. */
function readCycle(key) {
  const saved = { ...IDLE, ...read(key) };
  if (!PHASES.includes(saved.phase)) return { ...IDLE, day: saved.day, done: saved.done };
  const { day, done, phase, kind, until, left, startedAt, pausedAt, held, carry, carryId } = saved;
  return { day, done, phase, kind, until, left, startedAt, pausedAt, held, carry, carryId };
}

function readSettings() {
  const saved = read(SETTINGS_KEY);
  const out = { ...DEFAULTS };
  for (const [key, limits] of Object.entries(LIMITS)) {
    if (Number.isFinite(saved[key])) out[key] = clamp(saved[key], limits);
  }
  for (const key of ["autoBreak", "autoStart", "sound"]) {
    if (typeof saved[key] === "boolean") out[key] = saved[key];
  }
  return out;
}

/** Two short tones, so a finished phase is noticed from another tab. */
function chime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const t = ctx.currentTime + i * 0.28;
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.15, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      osc.start(t);
      osc.stop(t + 0.26);
    });
    setTimeout(() => ctx.close(), 900);
  } catch {
    // no audio available: the title and the header still show it
  }
}

/**
 * A pomodoro with a clock of its own: it counts down whether or not a project timer is
 * running, and nothing it does is logged. Project timers count up on their own and are
 * what lands in the log. The one link: when a focus ends (or "Break now"), a running
 * project timer is paused for the break (its session is stopped and kept) and the project
 * is `held`. Starting the next focus starts it again, and its clock carries on from the time
 * it had (`carry`) rather than from zero. Stopping the break, or starting a timer by hand
 * while it runs, lets the hold go. The link runs the other way too: starting a project timer by
 * hand starts the focus as well, if the pomodoro isn't already going (`followTimer`).
 *
 * When the focus length is up a break follows: it counts down at once if `autoBreak` is
 * on, otherwise it waits for Start. After the break the next focus is started (or offered).
 * A focus and a break can both be paused.
 *
 * A focus that ends is handed to `onFocusDone({ start, end, completed })` to be saved: `start` is
 * when it was first started (pauses included). When the countdown runs out, `end` is that moment and
 * `completed` is true. One stopped or cut short with "Break now" is saved too, with `completed` false
 * and `end` the moment it was stopped (or paused, if it was stopped from a pause), unless it lasted
 * less than a project timer needs to be kept: that was a mis-click.
 *
 * `phase` is "idle", "focus", "focusPaused", "breakWait" (break not started), "break",
 * "breakPaused" or "ready" (break over, next focus not started). Times are kept as an end
 * timestamp (`until`) while counting and seconds left (`left`) while paused, so a reload
 * picks up where it was. `scope` keeps the landing-page demo's cycle apart from the owner's.
 */
export function usePomodoro({ running, startTimer, stopTimer, onFocusDone, scope = "app" }) {
  const [settings, setSettingsState] = useState(readSettings);
  const cycleKey = `${CYCLE_KEY}-${scope}`;
  const [cycle, setCycleState] = useState(() => readCycle(cycleKey));
  const { phase } = cycle;
  const now = useNow(phase === "focus" || phase === "break");

  const setSettings = useCallback((patch) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      write(SETTINGS_KEY, next);
      return next;
    });
  }, []);
  const resetSettings = useCallback(() => setSettings(DEFAULTS), [setSettings]);

  const setCycle = useCallback(
    (update) =>
      setCycleState((prev) => {
        const next = typeof update === "function" ? update(prev) : update;
        write(cycleKey, next);
        return next;
      }),
    [cycleKey]
  );

  const focusSecs = settings.focus * 60;
  const focusRemaining =
    phase === "focus" ? Math.max(0, (cycle.until - now.getTime()) / 1000)
    : phase === "focusPaused" ? cycle.left
    : focusSecs;
  const breakSecs = (cycle.kind === "long" ? settings.longBreak : settings.shortBreak) * 60;
  const breakRemaining =
    phase === "break" ? Math.max(0, (cycle.until - now.getTime()) / 1000)
    : phase === "breakPaused" ? cycle.left
    : phase === "breakWait" ? breakSecs
    : 0;
  const focusing = phase === "focus" || phase === "focusPaused";
  const breaking = phase === "break" || phase === "breakPaused";

  // Pause a running project timer for the break: hold the project and what its clock showed.
  // The cycle is updated before the timer is stopped, so the stop is never read as one by hand.
  // Kept in a ref so the effects below don't re-run every time the timer starts or stops.
  const focusDone = useRef(null);
  focusDone.current = onFocusDone;
  const holdRunning = useRef(null);
  const heldSession = useRef(null);
  holdRunning.current = () => {
    if (!running) return;
    const id = running.project_id;
    heldSession.current = running.id;
    const shown = (cycle.carryId === id ? cycle.carry : 0) + sessionSeconds(running, new Date());
    setCycle((c) => ({ ...c, held: id, carry: Math.round(shown), carryId: id }));
    stopTimer({ keep: true });
  };

  // Save a focus that is being stopped or cut short. Kept in a ref like holdRunning, so the actions below keep their identity.
  const cutShort = useRef(null);
  cutShort.current = () => {
    if ((phase !== "focus" && phase !== "focusPaused") || !cycle.startedAt) return;
    const end = phase === "focusPaused" && cycle.pausedAt ? cycle.pausedAt : Date.now();
    if (end - cycle.startedAt < MIN_TIMER_SECONDS * 1000) return;
    focusDone.current?.({ start: new Date(cycle.startedAt), end: new Date(end), completed: false });
  };

  const beginFocus = useCallback(() => {
    const started = Date.now();
    setCycle((c) => ({ ...c, phase: "focus", left: 0, held: null, startedAt: started, until: started + settings.focus * 60_000 }));
  }, [settings.focus, setCycle]);

  /** Start a focus, and the project timer that was paused for the break, if there is one. */
  const startFocus = useCallback(() => {
    beginFocus();
    if (cycle.held) startTimer(cycle.held);
  }, [beginFocus, cycle.held, startTimer]);

  // A timer started by hand during the break lets the hold go. A project timer stopped by hand
  // (not held for a break) starts from zero next time.
  const wasRunning = useRef(Boolean(running));
  useEffect(() => {
    if (running && cycle.held && running.id !== heldSession.current) setCycle((c) => ({ ...c, held: null }));
    else if (!running && wasRunning.current && !cycle.held && cycle.carry) setCycle((c) => ({ ...c, carry: 0, carryId: null }));
    wasRunning.current = Boolean(running);
  }, [running, cycle.held, cycle.carry, setCycle]);

  // Focus is up: count it, stop the project timer, then break
  const finished = useRef(null);
  useEffect(() => {
    if (phase !== "focus" || focusRemaining > 0) return;
    if (finished.current === cycle.until) return;
    finished.current = cycle.until;
    // The end is the countdown's, not now: a focus that ran out while nobody was here keeps its real end.
    // One saved by an older version has no start, so it isn't kept.
    if (cycle.startedAt) focusDone.current?.({ start: new Date(cycle.startedAt), end: new Date(cycle.until), completed: true });
    if (settings.sound) chime();
    // A focus that ran out while nobody was here leaves a project timer alone: it may have been started since
    if (Date.now() - cycle.until < 10_000) holdRunning.current();
    setCycle((c) => {
      const day = dayKey(new Date());
      const done = (c.day === day ? c.done : 0) + 1;
      const long = done % settings.longEvery === 0;
      const mins = long ? settings.longBreak : settings.shortBreak;
      return {
        ...c, day, done, kind: long ? "long" : "short", left: 0,
        phase: settings.autoBreak ? "break" : "breakWait",
        until: settings.autoBreak ? Date.now() + mins * 60_000 : 0,
      };
    });
  }, [phase, focusRemaining, cycle.until, cycle.startedAt, setCycle, settings]);

  // Break is up: start the next focus, or wait to be asked. A break that ran out
  // while nobody was here (a reload, a closed laptop) never auto-starts.
  useEffect(() => {
    if (phase !== "break" || breakRemaining > 0) return;
    if (settings.sound) chime();
    const fresh = Date.now() - cycle.until < 10_000;
    if (settings.autoStart && fresh) startFocus();
    else setCycle((c) => ({ ...c, phase: "ready" }));
  }, [phase, breakRemaining, cycle.until, settings.autoStart, settings.sound, startFocus, setCycle]);

  /** Pause the focus: the time left stands still until Resume. A project timer is left alone. */
  const pause = useCallback(
    () => setCycle((c) => ({ ...c, phase: "focusPaused", pausedAt: Date.now(), left: Math.max(1, Math.round((c.until - Date.now()) / 1000)) })),
    [setCycle]
  );

  const resume = useCallback(
    () => setCycle((c) => ({ ...c, phase: "focus", until: Date.now() + c.left * 1000 })),
    [setCycle]
  );

  /** A project timer was just started by hand: bring the pomodoro along unless it is already going.
   *  A paused focus carries on, and one that hasn't started (or whose break is over) begins. A break,
   *  waiting or counting down, is left alone. The project timer isn't touched: a project that was paused
   *  for the break stays let go, the one just started takes its place. */
  const followTimer = useCallback(() => {
    if (phase === "focusPaused") resume();
    else if (phase === "idle" || phase === "ready") beginFocus();
  }, [phase, resume, beginFocus]);

  /** End the focus early and rest now. It's saved as cut short: it doesn't count toward the set. */
  const breakNow = useCallback(() => {
    cutShort.current();
    holdRunning.current();
    setCycle((c) => ({ ...c, phase: "break", kind: "short", left: 0, until: Date.now() + settings.shortBreak * 60_000 }));
  }, [settings.shortBreak, setCycle]);

  /** A break that was waiting: begin counting it down. */
  const startBreak = useCallback(
    () => setCycle((c) => ({ ...c, phase: "break", until: Date.now() + (c.kind === "long" ? settings.longBreak : settings.shortBreak) * 60_000 })),
    [settings.longBreak, settings.shortBreak, setCycle]
  );

  const pauseBreak = useCallback(
    () => setCycle((c) => ({ ...c, phase: "breakPaused", left: Math.max(1, Math.round((c.until - Date.now()) / 1000)) })),
    [setCycle]
  );

  const resumeBreak = useCallback(
    () => setCycle((c) => ({ ...c, phase: "break", until: Date.now() + c.left * 1000 })),
    [setCycle]
  );

  /** Stop whatever the pomodoro is doing and go back to idle. A focus stopped part-way is saved as cut
   *  short. The day's count stays; a project paused for the break stays stopped. */
  const dismiss = useCallback(() => {
    cutShort.current();
    setCycle((c) => ({ ...c, phase: "idle", left: 0, until: 0, held: null, carry: c.held ? 0 : c.carry }));
  }, [setCycle]);

  const done = cycle.day === dayKey(now) ? cycle.done : 0;

  return {
    settings,
    setSettings,
    resetSettings,
    phase,
    breakKind: cycle.kind,
    // The project paused for the break, and the time its clock showed when it was
    heldProjectId: cycle.held,
    heldSeconds: cycle.held ? cycle.carry : 0,
    // Time to add to the running session's clock: what it had before the break, if it's that project
    carry: running && running.project_id === cycle.carryId ? cycle.carry : 0,
    focusRemaining,
    focusProgress: focusing ? Math.min(1, 1 - focusRemaining / focusSecs) : 0,
    breakRemaining,
    breakProgress: breaking ? Math.min(1, 1 - breakRemaining / breakSecs) : 0,
    // Which pomodoro of the set the current (or next) focus is: 1..longEvery
    position: (done % settings.longEvery) + 1,
    startFocus,
    followTimer,
    pause,
    resume,
    breakNow,
    startBreak,
    pauseBreak,
    resumeBreak,
    dismiss,
  };
}
