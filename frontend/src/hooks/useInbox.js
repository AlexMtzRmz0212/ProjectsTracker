import { useCallback, useEffect, useMemo, useState } from "react";
import { interest } from "../api";

const SEEN_KEY = "pt-inbox-seen";

function readSeen() {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * The owner's side of the interest counter: the vote count and every note
 * visitors left. Does nothing unless `enabled` (never in the demo). A note is
 * "unread" until the inbox has been opened after it arrived.
 */
export function useInbox(enabled) {
  const [data, setData] = useState(null); // { count, messages } once loaded
  const [status, setStatus] = useState("idle"); // idle | loading | ready | error
  const [seen, setSeen] = useState(readSeen);

  const load = useCallback(async () => {
    setStatus((s) => (s === "ready" ? s : "loading"));
    try {
      setData(await interest.inbox());
      setStatus("ready");
    } catch {
      setStatus((s) => (s === "ready" ? s : "error"));
    }
  }, []);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  const messages = useMemo(() => data?.messages ?? [], [data]);
  // Compared against the server's own timestamps, so a skewed clock can't hide a note
  const unread = useMemo(() => messages.filter((m) => m.created_at.getTime() > seen).length, [messages, seen]);

  const markSeen = useCallback(() => {
    const newest = messages[0]?.created_at.getTime();
    if (!newest) return;
    setSeen(newest);
    try {
      localStorage.setItem(SEEN_KEY, String(newest));
    } catch {
      // storage blocked: the badge just comes back next visit
    }
  }, [messages]);

  const remove = useCallback(
    async (id) => {
      await interest.removeMessage(id);
      await load();
    },
    [load]
  );

  return { count: data?.count ?? 0, messages, status, unread, reload: load, markSeen, remove };
}
