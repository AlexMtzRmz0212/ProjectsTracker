import { useCallback, useEffect, useState } from "react";
import { format } from "../lib/dates";
import { Check, Copy, Plus, Trash2 } from "lucide-react";
import Modal, { Button } from "./Modal";
import { Field } from "../landing/AccountDialog";
import { admin, auth } from "../api";
import { __ } from "../i18n";

/** The signed-in person's account: who they are, a new password, and, for the admin, the invites. */
export default function AccountPanel({ user, onClose }) {
  return (
    <Modal title={__("Account")} onClose={onClose}>
      <p className="text-[13px] text-muted">{__("Signed in as")}</p>
      <p className="break-all font-serif text-lg font-semibold">{user.email}</p>

      <PasswordForm />
      {user.is_admin && <Invites />}
    </Modal>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [state, setState] = useState({ busy: false, error: null, done: false });

  const submit = async (e) => {
    e.preventDefault();
    if (!current || next.length < 8 || state.busy) return;
    setState({ busy: true, error: null, done: false });
    try {
      await auth.changePassword(current, next);
      setCurrent("");
      setNext("");
      setState({ busy: false, error: null, done: true });
    } catch (err) {
      setState({ busy: false, error: err.message || __("Couldn't change the password."), done: false });
    }
  };

  return (
    <form onSubmit={submit} className="mt-6 border-t border-line pt-5">
      <h3 className="font-serif text-[15px] font-semibold">{__("Change password")}</h3>
      <p className="mb-4 mt-1 text-[13px] text-muted">{__("Your other devices are signed out; this one stays in.")}</p>
      <Field label={__("Current password")} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} maxLength={200} />
      <Field label={__("New password (at least 8 characters)")} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} maxLength={200} />
      {state.error && (
        <p role="alert" className="mt-3 text-[13px] text-danger">
          {state.error}
        </p>
      )}
      {state.done && (
        <p role="status" className="mt-3 text-[13px] text-muted">{__("Password changed.")}</p>
      )}
      <Button type="submit" variant="outline" className="mt-4" disabled={!current || next.length < 8 || state.busy}>
        {state.busy ? __("Saving...") : __("Change password")}
      </Button>
    </form>
  );
}

const inviteState = (invite, now) => {
  if (invite.used_at) return __("Used by {email}", { email: invite.used_by_email ?? __("a deleted account") });
  if (invite.expires_at < now) return `Expired ${format(invite.expires_at, "d MMM")}`;
  return __("Unused, valid until {date}", { date: format(invite.expires_at, "d MMM") });
};

/** Admin only. A code is shown once, right after it is made, as a link that opens the sign-up form. */
function Invites() {
  const [invites, setInvites] = useState(null);
  const [fresh, setFresh] = useState(null); // { id, link }
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setInvites(await admin.listInvites());
    } catch {
      setError(__("Couldn't load the invites."));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const made = await admin.createInvite(7);
      setFresh({ id: made.id, link: `${window.location.origin}/?invite=${encodeURIComponent(made.code)}` });
      await load();
    } catch (err) {
      setError(err.message || __("Couldn't make an invite."));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fresh.link);
      setCopied(true);
    } catch {
      setError(__("Couldn't copy. Select the link and copy it by hand."));
    }
  };

  const revoke = async (id) => {
    setError(null);
    try {
      await admin.deleteInvite(id);
      if (fresh?.id === id) setFresh(null);
      await load();
    } catch {
      setError(__("Couldn't remove that invite."));
    }
  };

  const now = new Date();

  return (
    <div className="mt-6 border-t border-line pt-5">
      <div className="flex items-center gap-3">
        <h3 className="font-serif text-[15px] font-semibold">{__("Invites")}</h3>
        <Button variant="outline" className="ml-auto h-8 px-2.5 text-xs" onClick={create} disabled={busy}>
          <Plus size={14} />{" "}{__("New invite")}</Button>
      </div>
      <p className="mb-3 mt-1 text-[13px] text-muted">{__("Each link lets one person make an account, for a week. The link is shown only once.")}</p>

      {fresh && (
        <div className="mb-3 border border-line-strong p-3">
          <p className="break-all font-mono text-[12px]" data-testid="invite-link">
            {fresh.link}
          </p>
          <Button variant="primary" className="mt-2 h-8 px-2.5 text-xs" onClick={copy}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? __("Copied") : __("Copy link")}
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="mb-2 text-[13px] text-danger">
          {error}
        </p>
      )}

      {invites?.length === 0 && <p className="text-[13px] text-muted">{__("No invites yet.")}</p>}
      <ul>
        {(invites ?? []).map((invite) => (
          <li key={invite.id} className="flex items-center gap-2 border-t border-line py-2 text-[13px] first:border-t-0">
            <span className="min-w-0 flex-1 truncate text-muted">{inviteState(invite, now)}</span>
            <button
              onClick={() => revoke(invite.id)}
              className="grid size-8 shrink-0 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-danger"
              aria-label={invite.used_at ? __("Remove from the list") : __("Revoke this invite")}
              title={invite.used_at ? __("Remove from the list") : __("Revoke this invite")}
            >
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
