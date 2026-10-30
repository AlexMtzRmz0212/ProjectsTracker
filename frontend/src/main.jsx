import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/besley/wght.css";
import "@fontsource-variable/besley/wght-italic.css";
import "@fontsource-variable/libre-franklin/wght.css";
import "@fontsource-variable/caveat/wght.css";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// The service worker (public/sw.js) makes the app installable. Not in dev: a cached page would hide edits.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // unsupported or blocked: the site still works, just not installable
    });
  });
}
