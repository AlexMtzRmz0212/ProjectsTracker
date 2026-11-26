import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Layers, Swords, X } from "lucide-react";
import { __ } from "../i18n";

/**
 * The first step of Sort: which way to put the Feed in order. "Swipe" goes through one card at a time (projects and
 * tasks), "Playoff" has projects face each other two at a time. `onPick` gets "swipe" or "playoff".
 */
export default function SortChooser({ onPick, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "1") onPick("swipe");
      else if (e.key === "2") onPick("playoff");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onPick, onClose]);

  const options = [
    {
      id: "swipe",
      icon: Layers,
      title: __("Swipe"),
      note: __("One card at a time: right for “do soon”, left for “later”. Projects and tasks."),
    },
    {
      id: "playoff",
      icon: Swords,
      title: __("Playoff"),
      note: __("Two projects at a time: pick the one to do first. Fewer decisions to get an exact order."),
    },
  ];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={__("How do you want to sort?")}
      className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div className="w-full max-w-md border border-line-strong bg-bg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center">
          <h2 className="font-serif text-[17px] font-semibold">{__("How do you want to sort?")}</h2>
          <button
            onClick={onClose}
            aria-label={__("Close")}
            title={__("Close (Esc)")}
            className="ml-auto grid size-8 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <X size={17} />
          </button>
        </div>
        <div className="mt-4 grid gap-3">
          {options.map(({ id, icon: Icon, title, note }, i) => (
            <button
              key={id}
              onClick={() => onPick(id)}
              className="flex items-start gap-3 border border-line-strong p-3 text-left transition-colors hover:border-text hover:bg-surface-2"
            >
              <Icon size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold">{title}</span>
                <span className="mt-0.5 block font-serif text-xs italic text-muted">{note}</span>
              </span>
              <span className="figures ml-auto text-xs text-faint">{i + 1}</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
