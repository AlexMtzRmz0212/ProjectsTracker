import { useCallback, useEffect, useRef, useState } from "react";
import { useNow } from "./useNow";
import { dayKey, sessionSeconds } from "../lib/time";

export const DEFAULTS = {
  focus: 25, shortBreak: 5, longBreak: 15, longEvery: 4, autoBreak: false, autoStart: false, sound: true,
};
export const LIMITS = { focus: [1, 180], shortBreak: [1, 60], longBreak: [1, 120], longEvery: [2, 12] };

const SETTINGS_KEY = "pt-pomodoro";
const CYCLE_KEY = "pt-pomodoro-cycle";
const IDLE = { day: "", done: 0, phase: null, kind: "short", until: 0, left: 0, carry: 0, projectId: null };

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
 * Pomodoros on top of the project timer. A focus period is the running session
 * itself, so it survives a reload and the time lands in the log like any other.
 * When the focus length is up the session is stopped and a break follows: it counts
 * down at once if `autoBreak` is on, otherwise it waits for Start. Breaks are never
 * logged. After the break the next focus is started (or offered).
 *
 * Pausing a focus stops its session (kept, however short) and remembers how much of the
 * focus was done; Resume starts a new session that carries on with the rest. A break can
 * be paused too, and "Break now" ends a focus early to rest.
 *
 * The cycle's `phase` is null, "paused" (focus), "breakWait" (break not started),
 * "break", "breakPaused" or "ready" (break over, next focus not started).
 * `scope` keeps the landing-page demo's cycle apart from the owner's.
 */
export function usePomodoro({ running, startTimer, stopTimer, scope = "app" }) {
  const [settings, setSettingsState] = useState(readSettings);
  const cycleKey = `${CYCLE_KEY}-${scope}`;
  const [cycle, setCycleState] = useState(() => ({ ...IDLE, ...read(cycleKey) }));
  const onBreak = cycle.phase === "break";
  const paused = cycle.phase === "paused";
  const now = useNow(Boolean(running) || onBreak);

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
  // Earlier sessions of this same focus (before a pause) count too. A timer started by hand
  // while a pause or break was still showing is a new focus, so what was carried is ignored.
  const carry = running && cycle.phase ? 0 : cycle.carry;
  const focusElapsed = running ? carry + sessionSeconds(running, now) : paused ? carry : 0;
  const focusRemaining = running || paused ? Math.max(0, focusSecs - focusElapsed) : 0;
  const breakSecs = (cycle.kind === "long" ? settings.longBreak : settings.shortBreak) * 60;
  const breakRemaining = onBreak
    ? Math.max(0, (cycle.until - now.getTime()) / 1000)
    : cycle.phase === "breakPaused" ? cycle.left
    : cycle.phase === "breakWait" ? breakSecs
    : 0;
  const breaking = onBreak || cycle.phase === "breakPaused";

  // A timer started by hand (from a card) cancels any break or pause that was waiting. A focus
  // that was stopped for good leaves nothing to carry over into the next one.
  useEffect(() => {
    if (running && cycle.phase) setCycle((c) => ({ ...c, phase: null, carry: 0 }));
    else if (!running && !cycle.phase && cycle.carry) setCycle((c) => ({ ...c, carry: 0 }));
  }, [running, cycle.phase, cycle.carry, setCycle]);

  // Focus is up: log it, then break
  const finished = useRef(null);
  useEffect(() => {
    if (focusRemaining > 0) finished.current = null; // the focus length was raised: it can finish again
    if (!running || focusRemaining > 0) return;
    const key = running.start.getTime();
    if (finished.current === key) return;
    finished.current = key;
    (async () => {
      // The last stretch after a pause is part of a focus that was already under way: keep it
      if (!(await stopTimer({ keep: carry > 0 }))) return;
      if (settings.sound) chime();
      setCycle((c) => {
        const day = dayKey(new Date());
        const done = (c.day === day ? c.done : 0) + 1;
        const long = done % settings.longEvery === 0;
        const mins = long ? settings.longBreak : settings.shortBreak;
        return {
          ...c, day, done, kind: long ? "long" : "short", left: 0, carry: 0, projectId: running.project_id,
          phase: settings.autoBreak ? "break" : "breakWait",
          until: settings.autoBreak ? Date.now() + mins * 60_000 : 0,
        };
      });
    })();
  }, [running, focusRemaining, carry, stopTimer, setCycle, settings]);

  // Break is up: start the next focus, or wait to be asked. A break that ran out
  // while nobody was here (a reload, a closed laptop) never auto-starts.
  useEffect(() => {
    if (!onBreak || breakRemaining > 0) return;
    if (settings.sound) chime();
    const fresh = Date.now() - cycle.until < 10_000;
    if (settings.autoStart && fresh) {
      setCycle((c) => ({ ...c, phase: null }));
      startTimer(cycle.projectId);
    } else {
      setCycle((c) => ({ ...c, phase: "ready" }));
    }
  }, [onBreak, breakRemaining, cycle.until, cycle.projectId, settings.autoStart, settings.sound, startTimer, setCycle]);

  /** Pause the focus. Its session is stopped (and kept) so the log stays true; Resume picks up the rest. */
  const pause = useCallback(() => {
    if (!running) return;
    setCycle((c) => ({ ...c, phase: "paused", projectId: running.project_id, carry: Math.round(focusElapsed) }));
    stopTimer({ keep: true });
  }, [running, focusElapsed, stopTimer, setCycle]);

  /** Carry on with a paused focus: a new session for whatever time was left. */
  const resume = useCallback(() => {
    setCycle((c) => ({ ...c, phase: null }));
    startTimer(cycle.projectId);
  }, [cycle.projectId, startTimer, setCycle]);

  /** End the focus early and rest now. It isn't a finished pomodoro, so it doesn't count toward the set. */
  const breakNow = useCallback(() => {
    if (!running) return;
    setCycle((c) => ({
      ...c, phase: "break", kind: "short", left: 0, carry: 0, projectId: running.project_id,
      until: Date.now() + settings.shortBreak * 60_000,
    }));
    stopTimer({ keep: carry > 0 });
  }, [running, carry, settings.shortBreak, stopTimer, setCycle]);

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

  /** Skip the rest of the break, or answer "break over": start focusing again. */
  const startNext = useCallback(() => {
    setCycle((c) => ({ ...c, phase: null, carry: 0 }));
    startTimer(cycle.projectId);
  }, [cycle.projectId, startTimer, setCycle]);

  /** Leave the break, the pause, or the prompt after it, without starting anything. */
  const dismiss = useCallback(() => setCycle((c) => ({ ...c, phase: null })), [setCycle]);

  const done = cycle.day === dayKey(now) ? cycle.done : 0;

  return {
    settings,
    setSettings,
    resetSettings,
    // focus | paused | breakWait | break | breakPaused | ready | idle
    phase: running ? "focus" : cycle.phase ?? "idle",
    breakKind: cycle.kind,
    // The project the cycle is about while no timer runs: the one paused, or the one to focus on after the break
    projectId: cycle.projectId,
    focusRemaining,
    focusProgress: Math.min(1, focusElapsed / focusSecs),
    breakRemaining,
    breakProgress: breaking ? Math.min(1, 1 - breakRemaining / breakSecs) : 0,
    // Which pomodoro of the set the current (or next) focus is: 1..longEvery
    position: (done % settings.longEvery) + 1,
    pause,
    resume,
    breakNow,
    startBreak,
    pauseBreak,
    resumeBreak,
    startNext,
    dismiss,
  };
}
