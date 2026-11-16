import { useCallback, useEffect, useRef, useState } from "react";
import { UNAUTHORIZED_EVENT, api, auth } from "./api";
import { useInterest } from "./hooks/useInterest";
import { setStorageScope } from "./lib/storage";
import Tracker from "./Tracker";
import Landing from "./landing/Landing";
import AccountDialog from "./landing/AccountDialog";
import { __, useT, setLanguage } from "./i18n";

// Everyone sees the landing page and its demo. A real tracker is behind a sign-in; this flag only says
// "this browser has signed in before", so public visitors never ask the server about a session they can't have.
const SESSION_HINT = "pt-owner";

function hasHint() {
  try {
    return localStorage.getItem(SESSION_HINT) === "1";
  } catch {
    return false;
  }
}

function setHint(on) {
  try {
    if (on) localStorage.setItem(SESSION_HINT, "1");
    else localStorage.removeItem(SESSION_HINT);
  } catch {
    // storage blocked: the person just signs in again next visit
  }
}

/** The invite code in the link someone was sent (/?invite=CODE), if any. */
const inviteInUrl = () => new URLSearchParams(window.location.search).get("invite") || "";

export default function App() {
  useT();
  const [phase, setPhase] = useState(() => (hasHint() ? "checking" : "public")); // checking | public | app
  const [user, setUser] = useState(null);
  // null, or { mode: "signin" | "register", message?, code? } while the dialog is open
  const [dialog, setDialog] = useState(() => {
    const code = inviteInUrl();
    return code ? { mode: "register", code } : null;
  });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // The code is in the dialog now: take it out of the address bar, so a reload or a share doesn't carry it on
  useEffect(() => {
    if (inviteInUrl()) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const enter = useCallback((signedIn) => {
    setStorageScope(signedIn.id); // before the tracker mounts: what this browser remembers is per person
    if (signedIn.language) setLanguage(signedIn.language); // the account's language wins over this device's
    setHint(true);
    setUser(signedIn);
    setDialog(null);
    setPhase("app");
  }, []);

  const leave = useCallback(() => {
    setStorageScope(null);
    setHint(false);
    setUser(null);
    setPhase("public");
  }, []);

  useEffect(() => {
    if (phase !== "checking") return;
    let alive = true;
    auth
      .me()
      .then(({ authenticated, user: signedIn }) => {
        if (!alive) return;
        if (authenticated) return enter(signedIn);
        leave();
      })
      .catch(() => alive && setPhase("public"));
    return () => {
      alive = false;
    };
  }, [phase, enter, leave]);

  // The session ended while someone was working (cookie expired, password changed on another device)
  useEffect(() => {
    const onExpired = () => {
      if (phaseRef.current !== "app") return;
      leave();
      setDialog({ mode: "signin", message: __("Your session ended. Sign in again.") });
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onExpired);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onExpired);
  }, [leave]);

  const openSignIn = useCallback(async () => {
    try {
      const me = await auth.me();
      if (me.authenticated) return enter(me.user);
    } catch {
      // The session check itself failed, so a sign-in couldn't work either: say so
      setDialog({ mode: "signin", message: __("Couldn't reach the server. If you're running locally, restart the API.") });
      return;
    }
    setDialog({ mode: "signin" });
  }, [enter]);

  const signOut = useCallback(async () => {
    try {
      await auth.logout();
    } catch {
      // the cookie expires on its own; the local state is what matters here
    }
    leave();
  }, [leave]);

  if (phase === "checking") {
    return (
      <div className="grid min-h-[100dvh] place-items-center">
        <p className="font-serif text-sm italic text-muted">{__("Checking your session")}</p>
      </div>
    );
  }

  if (phase === "app") {
    return (
      <div className="h-dvh min-h-[34rem]">
        {/* Keyed by account, so nothing in memory carries over from one person to the next */}
        <Tracker key={user.id} api={api} user={user} onSignOut={signOut} />
      </div>
    );
  }

  return <PublicSite dialog={dialog} onOpenSignIn={openSignIn} onCloseDialog={() => setDialog(null)} onSignedIn={enter} />;
}

/** The landing page, plus the sign-in dialog that opens from its small lock. */
function PublicSite({ dialog, onOpenSignIn, onCloseDialog, onSignedIn }) {
  const interest = useInterest();

  useEffect(() => {
    document.title = "ProjectsTracker";
  }, []);

  return (
    <>
      <Landing interest={interest} onOwner={onOpenSignIn} />
      {dialog && (
        <AccountDialog
          mode={dialog.mode}
          message={dialog.message}
          code={dialog.code}
          interest={interest}
          onClose={onCloseDialog}
          onSuccess={onSignedIn}
        />
      )}
    </>
  );
}
