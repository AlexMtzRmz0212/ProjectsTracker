import { useState } from "react";
import { Check, Hand, Send } from "lucide-react";
import { Button } from "../components/Modal";

// Same loose shape the server accepts: the point is a reply address, nothing stricter.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fieldClass =
  "h-10 w-full min-w-0 border-0 border-b border-line-strong bg-transparent px-0 outline-none transition-colors focus:border-b-2 focus:border-accent-2 focus-visible:outline-none";

function Tally({ count, counted }) {
  if (count == null) {
    return counted ? <span className="text-[13px] text-muted">You're in the count.</span> : null;
  }
  if (count === 0) return <span className="text-[13px] text-muted">No one yet. Be the first.</span>;
  return (
    <span className="text-[13px] text-muted">
      {count === 1 ? "person would use this" : "people would use this"}
    </span>
  );
}

/** Optional follow-up: an email to reply to, a note, or both. Either one is enough. */
function NoteForm({ interest }) {
  const { noteSending, noteError, sendNote } = interest;
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState(null);
  const empty = !email.trim() && !message.trim();

  const submit = async (e) => {
    e.preventDefault();
    if (empty || noteSending) return;
    if (email.trim() && !EMAIL.test(email.trim())) {
      setFormError("That email doesn't look right.");
      return;
    }
    setFormError(null);
    await sendNote({ email: email.trim(), message: message.trim() });
  };

  const error = formError || noteError;

  return (
    <form onSubmit={submit} noValidate className="space-y-4 border-t border-line pt-4">
      <div>
        <h3 className="font-serif text-[15px] font-semibold">Want to say more?</h3>
        <p className="mt-1 text-[13px] text-muted">
          Leave an email for a reply, a note about how you'd use it, or both.
        </p>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-muted">Email</span>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={Boolean(formError)}
          className={fieldClass}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-muted">Note</span>
        <textarea
          rows={3}
          maxLength={1000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="w-full resize-y border border-line-strong bg-transparent px-3 py-2 text-[13px] outline-none transition-colors focus:border-accent-2 focus-visible:outline-none"
        />
      </label>

      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button variant="primary" type="submit" disabled={empty || noteSending}>
          <Send size={15} /> {noteSending ? "Sending..." : "Send"}
        </Button>
        <p className="min-w-0 flex-1 text-xs text-muted">Only I can read this, and I'll only use it to reply.</p>
      </div>
    </form>
  );
}

/**
 * The clicker: a ledger-style counter and one button. Counting asks for nothing.
 * Once counted, the visitor can optionally leave a note so the owner can reply;
 * the form opens by itself right after the click and stays folded away for
 * people who come back.
 */
export default function InterestWidget({ interest, compact = false }) {
  const { count, counted, justCounted, sending, error, add, noteSent } = interest;
  const [noteOpen, setNoteOpen] = useState(false);
  const showForm = counted && !noteSent && (justCounted || noteOpen);

  const button = counted ? (
    <span
      role="status"
      className="inline-flex h-11 items-center justify-center gap-2 border border-line-strong px-5 text-[13px] font-semibold"
    >
      <Check size={16} strokeWidth={2.5} /> You're counted
    </span>
  ) : (
    <Button variant="primary" onClick={add} disabled={sending} className="h-11 px-5">
      <Hand size={16} /> {sending ? "Counting..." : "I'd use this"}
    </Button>
  );

  const figure =
    count == null ? (
      <span className="block h-10 w-14 bg-surface-2" aria-hidden="true" />
    ) : (
      <span className={`figures double-rule inline-block font-semibold leading-none ${compact ? "text-3xl" : "text-5xl"}`}>
        {count}
      </span>
    );

  return (
    <div className="space-y-4">
      <div className={compact ? "flex flex-wrap items-center gap-x-5 gap-y-3" : "space-y-4"}>
        {compact ? (
          <>
            {button}
            <div className="flex items-baseline gap-2.5">
              {count != null && figure}
              <Tally count={count} counted={counted} />
            </div>
          </>
        ) : (
          <>
            <div className="flex items-end gap-3" aria-live="polite">
              {figure}
              <Tally count={count} counted={counted} />
            </div>
            {button}
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}

      {counted && noteSent && (
        <p role="status" className="flex items-center gap-2 text-[13px] text-muted">
          <Check size={15} strokeWidth={2.5} className="shrink-0" /> Your note is in. Thank you.
        </p>
      )}

      {counted && !noteSent && !showForm && (
        <button
          onClick={() => setNoteOpen(true)}
          className="text-[13px] font-semibold text-muted underline underline-offset-2 transition-colors hover:text-text"
        >
          Leave a note
        </button>
      )}

      {showForm && <NoteForm interest={interest} />}
    </div>
  );
}
