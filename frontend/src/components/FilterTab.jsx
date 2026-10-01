/** One choice in a row of filters: plain text, with an ink underline when selected. */
export default function FilterTab({ active, onClick, color, title, children }) {
  return (
    <button
      role="radio"
      aria-checked={active}
      onClick={onClick}
      title={title}
      className={`inline-flex h-7 items-center gap-1.5 border-b-2 text-[13px] transition-colors ${
        active ? "text-text" : "border-transparent text-muted hover:text-text"
      }`}
      style={active ? { borderColor: color } : undefined}
    >
      {children}
    </button>
  );
}
