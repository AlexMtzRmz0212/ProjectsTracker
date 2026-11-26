import { useRef, useState } from "react";
import { Minus, Plus, Repeat } from "lucide-react";
import { useClickOutside } from "../hooks/useClickOutside";
import { N_, __, _n } from "../i18n";

// Written here, passed through __ where they are drawn
const PRESETS = [[0, N_("No cadence")], [1, N_("Daily")], [7, N_("Weekly")], [30, N_("Monthly")]];

/**
 * A project's "done every N days", right where it shows: on its Feed card. The chip says it ("Every 7 days", or "Set
 * cadence" when it has none), and clicking it opens a small menu to change it in one step: a preset, or a number of
 * days. `onChange(days)` saves it (0 for none). The same setting is in the project's edit window.
 */
export default function CadenceChip({ days, onChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const root = useRef(null);
  useClickOutside(root, open, () => setOpen(false));

  const pick = (value) => {
    setOpen(false);
    if (value !== days) onChange(value);
  };
  const typed = Math.min(365, Math.max(0, Math.round(Number(draft) || 0)));
  // One day more or less, saved right away
  const step = (by) => {
    setOpen(false);
    onChange(Math.min(365, Math.max(0, days + by)));
  };
  const stepButton = "grid h-6 w-6 shrink-0 place-items-center border border-line-strong text-muted transition-colors hover:border-text hover:bg-surface-2 hover:text-text disabled:pointer-events-none disabled:opacity-40";

  return (
    <span ref={root} className="relative inline-flex items-center gap-1" onKeyDown={(e) => e.key === "Escape" && open && (e.stopPropagation(), setOpen(false))}>
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={days <= 0}
        aria-label={__("One day less between times it is done")}
        title={__("One day less")}
        className={stepButton}
      >
        <Minus size={12} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => {
          setDraft(days > 0 ? String(days) : "");
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-haspopup="true"
        title={__("How often it is meant to be done. Click to change")}
        className={`inline-flex h-6 items-center gap-1 border px-1.5 text-xs font-semibold not-italic transition-colors hover:border-text hover:bg-surface-2 hover:text-text ${
          days > 0 ? "border-line-strong text-text" : "border-dashed border-line-strong text-muted"
        } ${open ? "border-text bg-surface-2" : ""}`}
      >
        <Repeat size={12} aria-hidden="true" />
        {days > 0 ? _n(days, "Every {n} day", "Every {n} days") : __("Set cadence")}
      </button>
      <button
        type="button"
        onClick={() => step(1)}
        disabled={days >= 365}
        aria-label={__("One day more between times it is done")}
        title={__("One day more")}
        className={stepButton}
      >
        <Plus size={12} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-30 mt-1 w-52 border border-line-strong bg-surface p-1.5 text-[13px] shadow-[0_6px_24px_rgb(0_0_0/0.25)]">
          {PRESETS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={days === value}
              onClick={() => pick(value)}
              className={`flex h-8 w-full items-center px-2 text-left font-sans not-italic transition-colors hover:bg-surface-2 ${days === value ? "font-semibold text-text" : "text-muted hover:text-text"}`}
            >
              {__(label)}
            </button>
          ))}
          <form
            className="mt-1 flex items-center gap-2 border-t border-rule px-2 pt-2 font-sans not-italic"
            onSubmit={(e) => {
              e.preventDefault();
              pick(typed);
            }}
          >
            <input
              type="number"
              min={0}
              max={365}
              inputMode="numeric"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={__("Days between times it is done (0 for none)")}
              className="figures h-8 w-16 border-0 border-b border-line-strong bg-transparent px-0 text-[14px] outline-none focus:border-b-2 focus:border-accent-2"
            />
            <span className="text-muted">{__("days")}</span>
            <button type="submit" className="ml-auto h-7 border border-line-strong px-2 text-xs font-semibold transition-colors hover:border-text hover:bg-surface-2">
              {__("Set")}
            </button>
          </form>
        </div>
      )}
    </span>
  );
}
