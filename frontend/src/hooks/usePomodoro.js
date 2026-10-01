import { useCallback, useEffect, useRef, useState } from "react";
import { useNow } from "./useNow";
import { dayKey, sessionSeconds } from "../lib/time";

export const DEFAULTS = { focus: 25, shortBreak: 5, longBreak: 15, longEvery: 4, autoStart: false, sound: true };
export const LIMITS = { focus: [1, 180], shortBreak: [1, 60], longBreak: [1, 120], longEvery: [2, 12] };

const SETTINGS_KEY = "pt-pomodoro";
const CYCLE_KEY = "pt-pomodoro-cycle";
const IDLE = { day: "", done: 0, phase: null, kind: "short", until: 0, projectId: null };

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
  if (typeof saved.autoStart === "boolean") out.autoStart = saved.autoStart;
  if (typeof saved.sound === "boolean") out.sound = saved.sound;
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
 * When the focus length is up the session is stopped and a break counts down;
 * breaks are never logged. After the break the next focus is started (or offered).
 *
 * `scope` keeps the landing-page demo's cycle apart from the owner's.
 */
export function usePomodoro({ running, startTimer, stopTimer, scope = "app" }) {
  const [settings, setSettingsState] = useState(readSettings);
  const cycleKey = `${CYCLE_KEY}-${scope}`;
  const [cycle, setCycleState] = useState(() => ({ ...IDLE, ...read(cycleKey) }));
  const onBreak = cycle.phase === "break";
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
  const focusElapsed = running ? sessionSeconds(running, now) : 0;
  const focusRemaining = running ? Math.max(0, focusSecs - focusElapsed) : 0;
  const breakRemaining = onBreak ? Math.max(0, (cycle.until - now.getTime()) / 1000) : 0;
  const breakSecs = (cycle.kind === "long" ? settings.longBreak : settings.shortBreak) * 60;

  // A timer started by hand (from a card) cancels any break that was waiting
  useEffect(() => {
    if (running && cycle.phase) setCycle((c) => ({ ...c, phase: null }));
  }, [running, cycle.phase, setCycle]);

  // Focus is up: log it, then break
  const finished = useRef(null);
  useEffect(() => {
    if (focusRemaining > 0) finished.current = null; // the focus length was raised: it can finish again
    if (!running || focusRemaining > 0) return;
    const key = running.start.getTime();
    if (finished.current === key) return;
    finished.current = key;
    (async () => {
      if (!(await stopTimer())) return;
      if (settings.sound) chime();
      setCycle((c) => {
        const day = dayKey(new Date());
        const done = (c.day === day ? c.done : 0) + 1;
        const long = done % settings.longEvery === 0;
        const mins = long ? settings.longBreak : settings.shortBreak;
        return { day, done, phase: "break", kind: long ? "long" : "short", until: Date.now() + mins * 60_000, projectId: running.project_id };
      });
    })();
  }, [running, focusRemaining, stopTimer, setCycle, settings]);

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

  /** Skip the rest of the break, or answer "break over": start focusing again. */
  const startNext = useCallback(() => {
    setCycle((c) => ({ ...c, phase: null }));
    startTimer(cycle.projectId);
  }, [cycle.projectId, startTimer, setCycle]);

  /** Leave the break (or the prompt after it) without starting anything. */
  const dismiss = useCallback(() => setCycle((c) => ({ ...c, phase: null })), [setCycle]);

  const done = cycle.day === dayKey(now) ? cycle.done : 0;

  return {
    settings,
    setSettings,
    resetSettings,
    phase: running ? "focus" : cycle.phase ?? "idle", // focus | break | ready | idle
    breakKind: cycle.kind,
    breakProjectId: cycle.projectId,
    focusRemaining,
    focusProgress: Math.min(1, focusElapsed / focusSecs),
    breakRemaining,
    breakProgress: onBreak ? Math.min(1, 1 - breakRemaining / breakSecs) : 0,
    // Which pomodoro of the set the current (or next) focus is: 1..longEvery
    position: (done % settings.longEvery) + 1,
    startNext,
    dismiss,
  };
}
