import { useState } from "react";
import { Check, Target, ListChecks, X } from "lucide-react";
import { planFromReply } from "../lib/aiTasks";
import { iconFor, inkText } from "../lib/palette";
import { __, __r, _n, useT } from "../i18n";

/**
 * Where an AI's reply to the Workspace's "Copy for AI" is pasted. It is read and shown as the plan it suggests (each
 * thing with the AI's reason), and only goes onto "Next up" when you press Apply: in that order, at the front, with
 * anything already on the plan that the reply left out staying after it. Nothing is ever removed.
 * `resolve(id)` finds what an id from the prompt is (see planFromReply) and `onApply(picks)` puts them on the plan,
 * resolving to whether it worked.
 */
export default function PlanAiPanel({ resolve, onApply, onClose }) {
  useT();
  const [raw, setRaw] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);

  const preview = () => {
    try {
      setResult(planFromReply(raw, resolve));
      setError("");
    } catch (e) {
      setResult(null);
      setError(e.message);
    }
  };

  const apply = async () => {
    setApplying(true);
    const ok = await onApply(result.picks);
    setApplying(false);
    if (ok) onClose();
    else setError(__("Something went wrong"));
  };

  return (
    <section className="mb-3 shrink-0 border border-line-strong bg-surface p-3" aria-label={__("Paste the AI's reply")}>
      <div className="flex items-center gap-2">
        <h3 className="flex-1 font-serif text-[15px] font-semibold">{__("Paste the AI's reply")}</h3>
        <button
          onClick={onClose}
          aria-label={__("Close")}
          title={__("Close")}
          className="grid size-7 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <X size={15} />
        </button>
      </div>
      <p className="mt-0.5 text-[13px] text-muted">
        {__r("Use {copy}, paste it into any chat, then paste the JSON it answers with here. You see the plan before anything is saved, and nothing is removed.", { copy: <b>{__("Copy for AI")}</b> })}
      </p>
      <textarea
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          setResult(null);
          setError("");
        }}
        rows={5}
        spellCheck={false}
        placeholder={__("{\"order\":[{\"id\":\"project:…\",\"why\":\"Waited longest\"},{\"id\":\"habit:…\",\"why\":\"Not logged today\"}]}")}
        aria-label={__("The AI's reply")}
        className="figures mt-2 w-full resize-y border border-line-strong bg-transparent p-2.5 text-[12px] leading-relaxed outline-none transition-colors placeholder:text-faint focus:border-text"
      />
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-3">
          <ol className="max-h-72 divide-y divide-rule overflow-y-auto border-y border-rule">
            {result.picks.map((pick, i) => {
              const Icon = pick.kind === "project" ? iconFor(pick.icon) : pick.kind === "habit" ? Target : ListChecks;
              return (
                <li key={`${pick.kind}:${pick.ref}`} className="flex items-start gap-2 py-2 text-[13px]">
                  <span className="figures w-4 shrink-0 pt-0.5 text-right text-xs text-faint" aria-hidden="true">{i + 1}</span>
                  <Icon size={14} style={pick.color ? { color: inkText(pick.color) } : undefined} className={`mt-0.5 shrink-0 ${pick.color ? "" : "text-muted"}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="break-words font-semibold">{pick.name}</span>
                    {pick.context && <span className="ml-2 font-serif text-xs italic text-muted">{pick.context}</span>}
                    {pick.why && <span className="block font-serif text-xs italic text-muted">{pick.why}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
          {result.unknown > 0 && (
            <p className="mt-2 text-[13px] text-muted">
              {_n(result.unknown, "{n} item in the reply isn't something you can work on (any more), so it is left out.", "{n} items in the reply aren't something you can work on (any more), so they are left out.")}
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        {result ? (
          <>
            <button
              onClick={apply}
              disabled={applying}
              className="inline-flex h-8 items-center gap-1.5 border border-text bg-text px-3 text-xs font-semibold text-bg transition-opacity disabled:opacity-50"
            >
              <Check size={13} aria-hidden="true" />
              {_n(result.picks.length, "Put {n} thing at the front of Next up", "Put {n} things at the front of Next up")}
            </button>
            <button onClick={() => setResult(null)} className="h-8 px-2 text-xs text-muted transition-colors hover:text-text">{__("Back")}</button>
          </>
        ) : (
          <button
            onClick={preview}
            disabled={!raw.trim()}
            className="inline-flex h-8 items-center border border-line-strong px-3 text-xs font-semibold transition-colors hover:border-text hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40"
          >{__("Preview the plan")}</button>
        )}
      </div>
    </section>
  );
}
