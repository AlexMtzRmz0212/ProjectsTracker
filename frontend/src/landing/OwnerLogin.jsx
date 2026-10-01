import { useState } from "react";
import { LockKeyhole } from "lucide-react";
import Modal, { Button } from "../components/Modal";
import InterestWidget from "./InterestWidget";
import { auth } from "../api";

/** The way into the private tracker. Anyone who lands here without the password
 *  is invited to say they'd use the app, which is the point of the counter. */
export default function OwnerLogin({ message, interest, onClose, onSuccess }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await auth.login(password);
      onSuccess();
    } catch (err) {
      setError(
        err.status === 401
          ? "That password isn't right."
          : err.status === 404
            ? "The API has no login yet. Restart it so it loads the latest code."
            : err.message || "Couldn't sign in right now."
      );
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Owner sign in"
      onClose={onClose}
      footer={
        <>
          <Button className="ml-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!password || busy}>
            <LockKeyhole size={15} /> {busy ? "Signing in..." : "Sign in"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        {message && <p className="mb-4 text-[13px] text-muted">{message}</p>}
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted">Password</span>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={200}
            aria-invalid={Boolean(error)}
            className="h-10 w-full min-w-0 border-0 border-b border-line-strong bg-transparent px-0 outline-none transition-colors focus:border-b-2 focus:border-accent-2 focus-visible:outline-none"
          />
        </label>
        {error && (
          <p role="alert" className="mt-2 text-[13px] text-danger">
            {error}
          </p>
        )}
        <button type="submit" hidden />
      </form>

      <div className="mt-6 border-t border-line pt-5">
        <h3 className="font-serif text-[15px] font-semibold">No password? Ask for access.</h3>
        <p className="mb-4 mt-1 text-[13px] text-muted">The tracker is private for now. Say you'd use it and it gets counted.</p>
        <InterestWidget interest={interest} compact />
      </div>
    </Modal>
  );
}
