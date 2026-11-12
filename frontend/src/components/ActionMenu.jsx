import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ellipsis } from "lucide-react";
import { useClickOutside } from "../hooks/useClickOutside";

const MENU_W = 224; // px, as wide as the menu is
const EDGE = 8; // px kept clear of the window's edges

/**
 * A "more" button with a small menu of actions under it, for the controls a row doesn't need in sight all the
 * time. `items` is [{ label, icon: Icon, onClick, danger? }]; falsy entries are skipped. It closes on a pick, a
 * press outside, Esc, or when the page scrolls or resizes. The menu is placed with fixed coordinates under the
 * button (above it near the bottom of the window), so a scrolling list around it never clips it. It is drawn
 * into the page's body: inside a panel that slides in (the side peek is moved with a transform), fixed
 * coordinates would be taken from the panel, not the window, and the menu would land out of sight.
 */
export default function ActionMenu({ items, label = "More actions", className = "" }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState(null); // { left, top?, bottom? }
  const root = useRef(null);
  const button = useRef(null);
  const shown = items.filter(Boolean);

  useClickOutside(root, open, () => setOpen(false), "[data-action-menu]");

  useLayoutEffect(() => {
    if (!open) return;
    const rect = button.current.getBoundingClientRect();
    const left = Math.max(EDGE, Math.min(window.innerWidth - MENU_W - EDGE, rect.right - MENU_W));
    const below = window.innerHeight - rect.bottom;
    // Not enough room under the button for the items: open upward from its top edge
    setPlace(below < shown.length * 40 + 16 ? { left, bottom: window.innerHeight - rect.top + 4 } : { left, top: rect.bottom + 4 });
    const close = () => setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, shown.length]);

  return (
    <span ref={root} className="relative inline-flex">
      <button
        ref={button}
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        className={`grid size-7 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text ${open ? "bg-surface-2 text-text" : ""} ${className}`}
      >
        <Ellipsis size={16} />
      </button>
      {open && place && createPortal(
        <div
          role="menu"
          aria-label={label}
          data-action-menu
          className="fade-in fixed z-[70] border border-line-strong bg-surface py-1"
          style={{ width: MENU_W, ...place }}
        >
          {shown.map(({ label: text, icon: Icon, onClick, danger }) => (
            <button
              key={text}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onClick();
              }}
              className={`flex h-10 w-full items-center gap-3 px-3 text-left text-[13px] transition-colors hover:bg-surface-2 ${danger ? "text-danger" : ""}`}
            >
              {Icon && <Icon size={15} className={`shrink-0 ${danger ? "" : "text-muted"}`} aria-hidden="true" />}
              <span className="min-w-0 flex-1 truncate">{text}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </span>
  );
}
