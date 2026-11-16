import { useEffect, useState } from "react";
import { format } from "../lib/dates";
import { Trash2 } from "lucide-react";
import Modal, { Button } from "./Modal";
import { __, useT } from "../i18n";

/** mailto with the address percent-encoded, so nothing a visitor typed can add
 *  headers (?cc=, &body=) to the draft. The @ stays literal for older mail clients. */
const mailto = (email) => `mailto:${encodeURIComponent(email).replace("%40", "@")}`;

/** What visitors said after pressing "I'd use this". Owner only. */
export default function InterestInbox({ inbox, onClose }) {
  useT();
  const { count, messages, status, reload, markSeen, remove } = inbox;
  const [confirmId, setConfirmId] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    reload();
  }, [reload]);

  // Looking at the list is what clears the badge
  useEffect(() => {
    if (status === "ready") markSeen();
  }, [status, markSeen]);

  const erase = async (id) => {
    setFailed(false);
    try {
      await remove(id);
      setConfirmId(null);
    } catch {
      setFailed(true);
    }
  };

  return (
    <Modal title={__("Interest")} onClose={onClose}>
      <div className="flex items-end gap-3">
        <span className="figures double-rule inline-block text-5xl font-semibold leading-none">{count}</span>
        <span className="text-[13px] text-muted">{count === 1 ? __("person would use this") : __("people would use this")}</span>
      </div>
      <p className="mt-2 text-[13px] text-muted">
        {messages.length === 0 ? __("No notes yet.") : __("{length} left a note.", { length: messages.length })}
      </p>

      {status === "error" && (
        <p role="alert" className="mt-5 text-[13px] text-danger">
          {__("Couldn't load the notes.")}{" "}
          <button onClick={reload} className="font-semibold underline underline-offset-2">{__("Try again")}</button>
        </p>
      )}

      {status === "loading" && <div className="mt-5 h-24 animate-pulse bg-surface-2" aria-label={__("Loading")} />}

      {status === "ready" && messages.length === 0 && (
        <p className="mt-5 border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-muted">{__("Visitors can leave a note, with an email if they want a reply, right after they press the button.")}</p>
      )}

      {messages.length > 0 && (
        <ul className="mt-5 border-t border-rule">
          {messages.map((m) => (
            <li key={m.visitor_id} className="border-b border-rule py-3">
              <div className="flex items-baseline gap-3">
                {m.email ? (
                  <a href={mailto(m.email)} className="min-w-0 truncate text-[13px] font-semibold underline underline-offset-2">
                    {m.email}
                  </a>
                ) : (
                  <span className="font-serif text-[13px] italic text-muted">{__("No email left")}</span>
                )}
                <span className="figures ml-auto shrink-0 text-xs text-muted">{format(m.created_at, "d MMM, HH:mm")}</span>
              </div>
              {m.message && <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px]">{m.message}</p>}

              <div className="mt-2 flex items-center justify-end gap-2">
                {confirmId === m.visitor_id ? (
                  <>
                    <span className="mr-1 text-xs text-muted">{__("Delete this note for good?")}</span>
                    <Button className="h-7 px-2.5 text-xs" onClick={() => setConfirmId(null)}>{__("Keep")}</Button>
                    <Button variant="solidDanger" className="h-7 px-2.5 text-xs" onClick={() => erase(m.visitor_id)}>{__("Delete")}</Button>
                  </>
                ) : (
                  <Button
                    variant="danger"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setConfirmId(m.visitor_id)}
                    aria-label={__("Delete this note")}
                  >
                    <Trash2 size={13} />{" "}{__("Delete")}</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {failed && (
        <p role="alert" className="mt-3 text-[13px] text-danger">{__("Couldn't delete that. Try again.")}</p>
      )}
    </Modal>
  );
}
