import { Check, Square } from "lucide-react";
import Modal, { Button } from "./Modal";
import { useNow } from "../hooks/useNow";
import { fmtCountdown, fmtTime } from "../lib/time";
import { __ } from "../i18n";

// Esc and a press on the backdrop don't answer the question, so they do nothing: the buttons are the answers
const stay = () => {};

/**
 * "Still working on {name}?" when a timer or pomodoro has gone an hour with no sign of anyone being here. It counts
 * down to `answerBy` (ms), when whatever is running stops, ending at `askedAt` (ms) rather than when it is noticed.
 * `onYes` says someone is here; `onStop` stops it now.
 */
export default function StillWorkingDialog({ name, askedAt, answerBy, onYes, onStop }) {
  const now = useNow(true);
  const left = Math.max(0, Math.ceil((answerBy - now.getTime()) / 1000));
  return (
    <Modal
      title={__("Still working?")}
      onClose={stay}
      footer={
        <>
          <Button onClick={onStop}>
            <Square size={14} />{" "}{__("Stop now")}</Button>
          <Button variant="primary" className="ml-auto" onClick={onYes} autoFocus>
            <Check size={16} />{" "}{__("Yes, still working")}</Button>
        </>
      }
    >
      <p className="text-[14px]">{__("You have been on “{name}” for an hour with no sign of you since.", { name })}</p>
      <p className="mt-2 text-[13px] text-muted">
        {__("If there is no answer it stops, and the time ends at {time}, when this came up.", { time: fmtTime(new Date(askedAt)) })}
      </p>
      <p className="figures mt-3 text-3xl font-semibold tracking-tight" role="timer" aria-label={__("Time left to answer")}>
        {fmtCountdown(left)}
      </p>
    </Modal>
  );
}
