import { useCallback, useEffect, useState } from "react";
import { interest } from "../api";

const VISITOR_KEY = "pt-visitor";
const COUNTED_KEY = "pt-interest";
const NOTE_KEY = "pt-interest-note";

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage blocked: this visit just can't remember
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // see read()
  }
}

/** A random, anonymous id for this browser. It only stops one browser from being
 *  counted twice; it says nothing about who the visitor is. */
function visitorId() {
  let id = read(VISITOR_KEY);
  if (!id) {
    id =
      globalThis.crypto?.randomUUID?.() ??
      Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    write(VISITOR_KEY, id);
  }
  return id;
}

/**
 * The public "I'd use this" counter. `count` is null until the server answers
 * (or if it never does); the button works either way. After counting, a visitor
 * can also leave a note (an email to reply to, a message, or both).
 * `justCounted` is true only for the click made in this visit, so the note form
 * can open itself then and stay folded away for returning visitors.
 */
export function useInterest() {
  const [count, setCount] = useState(null);
  const [counted, setCounted] = useState(() => read(COUNTED_KEY) === "1");
  const [justCounted, setJustCounted] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [noteSent, setNoteSent] = useState(() => read(NOTE_KEY) === "1");
  const [noteSending, setNoteSending] = useState(false);
  const [noteError, setNoteError] = useState(null);

  useEffect(() => {
    let alive = true;
    interest
      .get()
      .then((r) => alive && setCount(r.count))
      .catch(() => {}); // the count simply stays hidden
    return () => {
      alive = false;
    };
  }, []);

  const add = useCallback(async () => {
    if (counted || sending) return;
    setSending(true);
    setError(null);
    try {
      const r = await interest.add(visitorId());
      setCount(r.count);
      setCounted(true);
      setJustCounted(true);
      write(COUNTED_KEY, "1");
    } catch (err) {
      setError(err.status === 429 ? err.message : "Couldn't save that right now. Try again in a moment.");
    } finally {
      setSending(false);
    }
  }, [counted, sending]);

  /** Resolves true when the note was saved, so the form knows to close. */
  const sendNote = useCallback(
    async ({ email, message }) => {
      if (noteSending) return false;
      setNoteSending(true);
      setNoteError(null);
      try {
        const r = await interest.send(visitorId(), { email, message });
        setCount(r.count);
        setCounted(true);
        setNoteSent(true);
        write(COUNTED_KEY, "1");
        write(NOTE_KEY, "1");
        return true;
      } catch (err) {
        setNoteError(err.status === 429 ? err.message : "Couldn't send that right now. Try again in a moment.");
        return false;
      } finally {
        setNoteSending(false);
      }
    },
    [noteSending]
  );

  return { count, counted, justCounted, sending, error, add, noteSent, noteSending, noteError, sendNote };
}
