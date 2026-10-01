import { useCallback, useEffect, useRef, useState } from "react";
import { UNAUTHORIZED_EVENT, api, auth } from "./api";
import { useInterest } from "./hooks/useInterest";
import Tracker from "./Tracker";
import Landing from "./landing/Landing";
import OwnerLogin from "./landing/OwnerLogin";

// Everyone sees the landing page and its demo. The owner's real tracker is
// behind a login; this flag only says "this browser has signed in before", so
// public visitors never ask the server about a session they can't have.
const OWNER_HINT = "pt-owner";

function hasHint() {
  try {
    return localStorage.getItem(OWNER_HINT) === "1";
  } catch {
    return false;
  }
}

function setHint(on) {
  try {
    if (on) localStorage.setItem(OWNER_HINT, "1");
    else localStorage.removeItem(OWNER_HINT);
  } catch {
    // storage blocked: the owner just signs in again next visit
  }
}

export default function App() {
  const [phase, setPhase] = useState(() => (hasHint() ? "checking" : "public")); // checking | public | owner
  const [authRequired, setAuthRequired] = useState(true); // false only in password-less local dev
  const [login, setLogin] = useState(null); // null, or { message? } while the dialog is open
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const enter = useCallback((required) => {
    setAuthRequired(required);
    setHint(true);
    setLogin(null);
    setPhase("owner");
  }, []);

  useEffect(() => {
    if (phase !== "checking") return;
    let alive = true;
    auth
      .me()
      .then(({ authenticated, required }) => {
        if (!alive) return;
        if (authenticated) return enter(required);
        setHint(false);
        setPhase("public");
      })
      .catch(() => alive && setPhase("public"));
    return () => {
      alive = false;
    };
  }, [phase, enter]);

  // The session ended while the owner was working (cookie expired, password changed)
  useEffect(() => {
    const onExpired = () => {
      if (phaseRef.current !== "owner") return;
      setHint(false);
      setPhase("public");
      setLogin({ message: "Your session ended. Sign in again." });
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onExpired);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onExpired);
  }, []);

  const openOwner = useCallback(async () => {
    try {
      const me = await auth.me();
      if (me.authenticated) return enter(me.required);
    } catch {
      // The session check itself failed, so a password prompt couldn't work either: say so
      setLogin({ message: "Couldn't reach the login service. If you're running locally, restart the API." });
      return;
    }
    setLogin({});
  }, [enter]);

  const signOut = useCallback(async () => {
    try {
      await auth.logout();
    } catch {
      // the cookie expires on its own; the local state is what matters here
    }
    setHint(false);
    setPhase("public");
  }, []);

  if (phase === "checking") {
    return (
      <div className="grid min-h-[100dvh] place-items-center">
        <p className="font-serif text-sm italic text-muted">Checking your session</p>
      </div>
    );
  }

  // Without a login (local dev) the button still leaves the tracker, so the landing page stays reachable
  if (phase === "owner") {
    return (
      <Tracker
        api={api}
        onSignOut={signOut}
        signOutLabel={authRequired ? "Sign out" : "Back to the public page"}
      />
    );
  }

  return (
    <PublicSite login={login} onOpenLogin={openOwner} onCloseLogin={() => setLogin(null)} onLoggedIn={() => enter(true)} />
  );
}

/** The landing page, plus the sign-in dialog that opens from its small lock. */
function PublicSite({ login, onOpenLogin, onCloseLogin, onLoggedIn }) {
  const interest = useInterest();

  useEffect(() => {
    document.title = "ProjectsTracker";
  }, []);

  return (
    <>
      <Landing interest={interest} onOwner={onOpenLogin} />
      {login && (
        <OwnerLogin message={login.message} interest={interest} onClose={onCloseLogin} onSuccess={onLoggedIn} />
      )}
    </>
  );
}
