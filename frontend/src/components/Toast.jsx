import { useEffect } from "react";
import { TriangleAlert, X } from "lucide-react";

export default function Toast({ notice, onDismiss }) {
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(onDismiss, 5000);
    return () => clearTimeout(id);
  }, [notice, onDismiss]);

  if (!notice) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
      <div
        key={notice.id}
        role="alert"
        className="fade-in pointer-events-auto flex max-w-md items-center gap-3 border border-l-[3px] border-line-strong border-l-danger bg-surface py-2.5 pl-3.5 pr-2.5"
      >
        <TriangleAlert size={17} className="shrink-0 text-danger" />
        <span className="text-[13px]">{notice.text}</span>
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
