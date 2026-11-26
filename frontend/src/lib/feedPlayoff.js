// The Feed's playoff sort, no React: projects face each other two at a time and the answers build the order.
// Same method as the album sorter in Hell-o-Fame: binary insertion through matches.

import { scopedKey } from "./storage";

const SAVED = "pt-feed-playoff";

/**
 * Binary insertion through matches. Projects enter one at a time and the newcomer (the challenger) faces the project
 * in the middle of the places it could still take, so every answer halves them; nothing that already follows from
 * earlier answers is asked. `answers` are the winners' ids ("do this first"), in order. Replaying them gives either
 * the next match or the final order (first in the Feed first).
 */
export function playoff(ids, answers) {
  const ladder = ids.slice(0, 1);
  let played = 0;
  for (let i = 1; i < ids.length; i++) {
    const challenger = ids[i];
    let lo = 0;
    let hi = ladder.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (played >= answers.length) {
        return { done: false, ladder, challenger, opponent: ladder[mid], lo, hi, mid, played, waiting: ids.slice(i + 1) };
      }
      if (answers[played++] === challenger) hi = mid;
      else lo = mid + 1;
    }
    ladder.splice(lo, 0, challenger);
  }
  return { done: true, order: ladder, played };
}

const ceilLog2 = (n) => Math.ceil(Math.log2(n));

/** The most matches n projects can take (6 projects: 11, where every pair would be 15). */
export function maxMatches(n) {
  let total = 0;
  for (let k = 2; k <= n; k++) total += ceilLog2(k);
  return total;
}

/** The playoff in a fixed order (by id), so saved answers replay the same way whatever order the Feed is in. */
export const playoffIds = (ids) => [...ids].sort();

const keyOf = (ids) => playoffIds(ids).join(",");

/** The answers left from a playoff that was closed half way, if it was for these same projects. */
export function loadAnswers(ids) {
  try {
    const saved = JSON.parse(localStorage.getItem(scopedKey(SAVED)));
    return saved?.key === keyOf(ids) && Array.isArray(saved.answers) ? saved.answers : [];
  } catch {
    return [];
  }
}

/** Keep the answers so far (an empty list forgets them). */
export function saveAnswers(ids, answers) {
  try {
    if (answers.length) localStorage.setItem(scopedKey(SAVED), JSON.stringify({ key: keyOf(ids), answers }));
    else localStorage.removeItem(scopedKey(SAVED));
  } catch {
    // storage blocked: the playoff starts over next time
  }
}
