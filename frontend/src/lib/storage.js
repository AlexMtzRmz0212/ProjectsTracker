// What this browser remembers about one person (the Feed's order, filters, the pomodoro's countdown...) is
// kept under a key that carries their user id, so two accounts that share a browser never share these.
// The scope is set when an account signs in, before its tracker mounts, and cleared when it signs out; the
// landing-page demo runs with none. Per-device choices (theme, the mini player's window size) and the public
// "I'd use this" bookkeeping are not scoped: they are about the device, not the person.

let suffix = "";

export function setStorageScope(userId) {
  suffix = userId ? `:${userId}` : "";
}

/** `key`, made specific to whoever is signed in. */
export const scopedKey = (key) => key + suffix;
