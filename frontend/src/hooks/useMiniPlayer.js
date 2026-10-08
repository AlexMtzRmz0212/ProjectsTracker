import { useCallback, useEffect, useRef, useState } from "react";

/** Whether the browser can open a small always-on-top window of its own (Document Picture-in-Picture:
 *  desktop Chrome and Edge). Elsewhere the mini clock is a widget floating inside the page. */
const canFloat = () => typeof window !== "undefined" && "documentPictureInPicture" in window;

/** Give a new window the page's styles, so what is drawn into it looks the same. Linked sheets are linked
 *  again (their urls keep working); the rest are copied rule by rule. */
function copyStyles(win) {
  for (const sheet of document.styleSheets) {
    try {
      if (sheet.href) throw new Error("linked");
      const style = win.document.createElement("style");
      style.textContent = [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
      win.document.head.appendChild(style);
    } catch {
      if (!sheet.href) continue;
      const link = win.document.createElement("link");
      link.rel = "stylesheet";
      link.href = sheet.href;
      win.document.head.appendChild(link);
    }
  }
}

/** Keep a window's theme (the `data-theme` on <html>) in step with the page's. Returns a way to stop. */
function followTheme(win) {
  const sync = () => {
    const theme = document.documentElement.dataset.theme;
    if (theme) win.document.documentElement.dataset.theme = theme;
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

/**
 * The mini clock's window. `show()` (from a click) opens it: a floating window when the browser has
 * Document Picture-in-Picture, `pip` being that window, which the clock is then drawn into; otherwise, or
 * when the browser refuses, `pip` stays null and the clock is a widget inside the page. `close()` (or the
 * window's own close button) puts it away. `open` is whether it is out in either form.
 */
export function useMiniPlayer() {
  const [open, setOpen] = useState(false);
  const [pip, setPip] = useState(null);
  const winRef = useRef(null);
  const pending = useRef(false); // a floating window has been asked for and hasn't come yet
  const stopTheme = useRef(null);

  const close = useCallback(() => {
    stopTheme.current?.();
    stopTheme.current = null;
    const win = winRef.current;
    winRef.current = null;
    setPip(null);
    setOpen(false);
    win?.close();
  }, []);

  const show = useCallback(async () => {
    if (winRef.current || pending.current) return;
    if (!canFloat()) return setOpen(true);
    pending.current = true;
    try {
      const win = await window.documentPictureInPicture.requestWindow({ width: 320, height: 176 });
      copyStyles(win);
      stopTheme.current = followTheme(win);
      win.addEventListener("pagehide", () => {
        // The window was closed from its own title bar
        if (winRef.current !== win) return;
        stopTheme.current?.();
        stopTheme.current = null;
        winRef.current = null;
        setPip(null);
        setOpen(false);
      });
      winRef.current = win;
      setPip(win);
    } catch {
      // Refused (no user gesture, or the browser said no): the widget inside the page does the job
    } finally {
      pending.current = false;
      setOpen(true);
    }
  }, []);

  // Leaving the tracker takes the window with it
  useEffect(
    () => () => {
      stopTheme.current?.();
      winRef.current?.close();
    },
    []
  );

  return { open, pip, show, close, floats: canFloat() };
}
