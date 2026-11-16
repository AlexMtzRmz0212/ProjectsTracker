import { auth } from "../api";
import { __, useT, setLanguage, LANGUAGES } from "../i18n";

/** EN | ES. Signed in (`persist`), the choice is also kept on the account, so it follows the person to other devices. */
export default function LanguageToggle({ persist = false, className = "" }) {
  const current = useT();

  const pick = (code) => {
    if (code === current) return;
    setLanguage(code);
    // The page has already switched; if saving fails the account just keeps its old language until the next change
    if (persist) auth.saveLanguage(code).catch(() => {});
  };

  return (
    <div role="group" aria-label={__("Language")} className={`inline-flex h-8 shrink-0 border border-line-strong ${className}`}>
      {LANGUAGES.map(({ code, label, name }) => (
        <button
          key={code}
          type="button"
          lang={code}
          onClick={() => pick(code)}
          aria-pressed={current === code}
          title={name}
          className={`px-2 text-xs font-semibold transition-colors ${
            current === code ? "bg-text text-bg" : "text-muted hover:bg-surface-2 hover:text-text"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
