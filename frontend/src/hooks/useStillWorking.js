import { useCallback, useEffect, useRef, useState } from "react";
import { useNow } from "./useNow";
import { scopedKey } from "../lib/storage";

/** After this long with no sign of anyone being here, a timer or pomodoro that is still going asks "still working?". */
export const ASK_AFTER_MS = 60 * 60_000;
/** How long that question is left to be answered before whatever is running is stopped. */
export const ANSWER_MS = 5 * 60_000;

const KEY = "pt-still-working";

function loadConfirmed() {
  try {
    return Number(localStorage.getItem(scopedKey(KEY))) || 0;
  } catch {
    return 0;
  }
}

/**
 * Asks every hour whether anyone is still working on what is running, and stops it if nobody says so.
 *
 * What counts as a sign of someone being here (the last moment, `last`): a project or task timer starting (the
 * session's start), a pomodoro being started, paused or resumed by hand (`pomodoro.confirmedAt`; a focus that
 * follows a break by itself doesn't count), or an answer to the question (kept in this browser). An hour after
 * `last` the question comes up (`asking`, with `askedAt` the moment it did); `ANSWER_MS` later, with no answer, it
 * stops: `onStop({ at: askedAt, timer, pomodoro })` is called once, `at` being when the question came up (ms) so the
 * time logged ends there, not hours later. Everything compares timestamps, so a reload, a throttled background tab or
 * a laptop that was asleep still lands where it should: one that wakes up long past the deadline stops it at once.
 *
 * Open items and a to-do marked as being worked on are meant to run for days: they never ask. A paused pomodoro,
 * and a break waiting to be started, aren't running either. `enabled` is off in the demo.
 *
 * Returns `{ asking, askedAt, answerBy, answer }`: whether the question is up, when it came up and when it runs out
 * (ms), and `answer()` for "yes, still working".
 */
export function useStillWorking({ enabled = true, running, pomodoro, onStop }) {
  const timerOn = Boolean(running);
  const pomodoroOn = pomodoro.phase === "focus" || pomodoro.phase === "break";
  const active = enabled && (timerOn || pomodoroOn);
  const now = useNow(active);
  const [confirmed, setConfirmed] = useState(loadConfirmed);

  const last = Math.max(
    confirmed,
    timerOn ? running.start.getTime() : 0,
    pomodoroOn ? pomodoro.confirmedAt || 0 : 0
  );
  // Nothing known about when anyone was last here (a pomodoro saved before this existed): never guess it was long ago
  const known = last > 0;
  const askedAt = last + ASK_AFTER_MS;
  const answerBy = askedAt + ANSWER_MS;
  const nowMs = now.getTime();
  const asking = active && known && nowMs >= askedAt;
  const expired = asking && nowMs >= answerBy;

  const latest = useRef(null);
  latest.current = { onStop, askedAt, timerOn, pomodoroOn };
  const stopping = useRef(false);
  useEffect(() => {
    if (!expired) {
      stopping.current = false;
      return;
    }
    if (stopping.current) return;
    stopping.current = true;
    const { onStop: stop, askedAt: at, timerOn: timer, pomodoroOn: pomodoroGoing } = latest.current;
    Promise.resolve(stop({ at, timer, pomodoro: pomodoroGoing })).finally(() => {
      // If it is still going after a failed stop, try again in a while rather than every second
      setTimeout(() => {
        stopping.current = false;
      }, 30_000);
    });
  }, [expired]);

  const confirmPomodoro = pomodoro.confirm;
  const answer = useCallback(() => {
    const at = Date.now();
    setConfirmed(at);
    try {
      localStorage.setItem(scopedKey(KEY), String(at));
    } catch {
      // storage blocked: the answer holds until the page is reloaded
    }
    confirmPomodoro?.();
  }, [confirmPomodoro]);

  return { asking: asking && !expired, askedAt, answerBy, answer, timer: timerOn, pomodoro: pomodoroOn };
}
