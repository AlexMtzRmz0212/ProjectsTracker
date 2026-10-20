import { useEffect } from "react";
import { Check, TriangleAlert, X } from "lucide-react";

/** A message at the bottom of the screen: an error by default, or a plain note (`tone: "info"`). A notice
 *  can carry an `action` ({ label, run }), a button that does something and closes it (Undo, for one). */
export default function Toast({ notice, onDismiss }) {
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(onDismiss, notice.action ? 7000 : 5000);
    return () => clearTimeout(id);
  }, [notice, onDismiss]);

  if (!notice) return null;
  const info = notice.tone === "info";
  const Icon = info ? Check : TriangleAlert;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+var(--bottom-bar,0px))] z-[60] flex justify-center px-4">
      <div
        key={notice.id}
        role={info ? "status" : "alert"}
        className={`fade-in pointer-events-auto flex max-w-md items-center gap-3 border border-l-[3px] border-line-strong bg-surface py-2.5 pl-3.5 pr-2.5 ${
          info ? "border-l-accent" : "border-l-danger"
        }`}
      >
        <Icon size={17} className={`shrink-0 ${info ? "text-accent" : "text-danger"}`} />
        <span className="min-w-0 break-words text-[13px]">{notice.text}</span>
        {notice.action && (
          <button
            onClick={() => {
              onDismiss();
              notice.action.run();
            }}
            className="h-7 shrink-0 px-2 text-xs font-semibold underline underline-offset-2 transition-colors hover:bg-surface-2"
          >
            {notice.action.label}
          </button>
        )}
        <button
          onClick={onDismiss}
          className="grid size-7 shrink-0 place-items-center text-muted transition-colors hover:text-text"
          aria-label="Dismiss"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
