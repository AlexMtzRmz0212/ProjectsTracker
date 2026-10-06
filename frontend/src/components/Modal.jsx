import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** Bottom sheet on phones, centered paper slip on larger screens. Esc / backdrop close it. */
export default function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="fade-in absolute inset-0 bg-(--scrim)" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fade-in relative flex max-h-[92dvh] w-full max-w-lg flex-col border border-line-strong bg-surface"
      >
        <div className="flex items-center justify-between gap-3 border-b-[3px] border-double border-line-strong py-3 pl-5 pr-3 sm:pl-6">
          <h2 className="font-serif text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="grid size-9 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-5 sm:px-6">
          {children}
        </div>
        {footer && <div className="flex items-center gap-2 border-t border-line px-5 py-3 sm:px-6">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export function Button({ variant = "ghost", className = "", style, ...props }) {
  const variants = {
    primary: "bg-text text-bg hover:opacity-90",
    outline: "border border-line-strong text-text hover:border-text",
    ghost: "text-muted hover:bg-surface-2 hover:text-text",
    danger: "text-danger hover:bg-danger/10",
    solidDanger: "bg-danger text-bg hover:opacity-90",
  };
  return (
    <button
      className={`inline-flex h-9 items-center justify-center gap-2 px-3.5 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${className}`}
      style={style}
      {...props}
    />
  );
}
