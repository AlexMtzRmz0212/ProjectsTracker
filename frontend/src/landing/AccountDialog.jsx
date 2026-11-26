import { useState } from "react";
import { LockKeyhole, UserPlus } from "lucide-react";
import Modal, { Button } from "../components/Modal";
import InterestWidget from "./InterestWidget";
import { auth } from "../api";
import { __ } from "../i18n";

const FIELD =
  "h-10 w-full min-w-0 border-0 border-b border-line-strong bg-transparent px-0 outline-none transition-colors focus:border-b-2 focus:border-accent-2 focus-visible:outline-none";

export function Field({ label, error, ...props }) {
  return (
    <label className="mt-4 block first:mt-0">
      <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>
      <input aria-invalid={Boolean(error)} className={FIELD} {...props} />
    </label>
  );
}

/** The way into the private tracker: sign in, or, with an invite code, make an account. Anyone who lands here
 *  without either is invited to say they'd use the app, which is the point of the counter. */
export default function AccountDialog({ mode: startMode = "signin", message, code: startCode = "", interest, onClose, onSuccess }) {
  const [mode, setMode] = useState(startMode); // signin | register
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState(startCode);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const register = mode === "register";

  const ready = email.trim() && password && (!register || (code.trim() && password.length >= 8));

  const submit = async (e) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const user = register
        ? await auth.register({ code: code.trim(), email: email.trim(), password })
        : await auth.login(email.trim(), password);
      onSuccess(user);
    } catch (err) {
      setError(
        err.status === 401
          ? __("That email and password don't match.")
          : err.status === 404
            ? __("The API has no accounts yet. Restart it so it loads the latest code.")
            : err.message || __("Couldn't sign in right now.")
      );
      setBusy(false);
    }
  };

  const switchTo = (next) => {
    setMode(next);
    setError(null);
  };

  return (
    <Modal
      title={register ? __("Create your account") : __("Sign in")}
      onClose={onClose}
      footer={
        <>
          <Button className="ml-auto" onClick={onClose}>{__("Cancel")}</Button>
          <Button variant="primary" onClick={submit} disabled={!ready || busy}>
            {register ? <UserPlus size={15} /> : <LockKeyhole size={15} />}
            {busy ? (register ? __("Creating...") : __("Signing in...")) : register ? __("Create account") : __("Sign in")}
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        {message && <p className="mb-4 text-[13px] text-muted">{message}</p>}
        {register && (
          <Field
            label={__("Invite code")}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={100}
            autoComplete="off"
            spellCheck={false}
            error={error}
          />
        )}
        <Field
          label={__("Email")}
          type="email"
          autoFocus={!register || Boolean(startCode)}
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={254}
          error={error}
        />
        <Field
          label={register ? __("Password (at least 8 characters)") : __("Password")}
          type="password"
          autoComplete={register ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          maxLength={200}
          error={error}
        />
        {error && (
          <p role="alert" className="mt-3 text-[13px] text-danger">
            {error}
          </p>
        )}
        <button type="submit" hidden />
      </form>

      <p className="mt-4 text-[13px] text-muted">
        {register ? (
          <>
            {__("Already have an account?")}{" "}
            <button onClick={() => switchTo("signin")} className="font-semibold text-text underline underline-offset-2">{__("Sign in")}</button>
          </>
        ) : (
          <>
            {__("Have an invite code?")}{" "}
            <button onClick={() => switchTo("register")} className="font-semibold text-text underline underline-offset-2">{__("Create your account")}</button>
          </>
        )}
      </p>

      {!register && (
        <div className="mt-6 border-t border-line pt-5">
          <h3 className="font-serif text-[15px] font-semibold">{__("No account? Ask for access.")}</h3>
          <p className="mb-4 mt-1 text-[13px] text-muted">{__("The tracker is invite-only for now. Say you'd use it and it gets counted.")}</p>
          <InterestWidget interest={interest} compact />
        </div>
      )}
    </Modal>
  );
}
