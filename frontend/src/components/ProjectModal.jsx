import { useState } from "react";
import { Check } from "lucide-react";
import Modal, { Button } from "./Modal";
import { ON_INK, PROJECT_COLORS, PROJECT_ICONS, iconFor, inkFor, inkText, tint } from "../lib/palette";

/** A random item from `preferred`, or from `fallback` when `preferred` is empty. */
function pickRandom(preferred, fallback = preferred) {
  const pool = preferred.length ? preferred : fallback;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Create or edit a project: name, ink, icon and status, with a live preview of its ledger line.
 *  `defaultStatusId` pre-selects a status for a new project (the one the page is filtered to). */
export default function ProjectModal({ project, statuses, defaultStatusId = null, usedColors, onClose, onSave }) {
  const editing = Boolean(project);
  const [name, setName] = useState(project?.name ?? "");
  const [color, setColor] = useState(
    () => project?.color ?? pickRandom(PROJECT_COLORS.filter((c) => !usedColors.includes(c)), PROJECT_COLORS)
  );
  const [icon, setIcon] = useState(() => project?.icon ?? pickRandom(Object.keys(PROJECT_ICONS)));
  const [statusId, setStatusId] = useState(
    project?.status_id ?? defaultStatusId ?? statuses.find((s) => !s.is_done)?.id ?? statuses[0]?.id
  );
  const [saving, setSaving] = useState(false);
  const Icon = iconFor(icon);
  const valid = name.trim().length > 0;

  const submit = async (e) => {
    e?.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    const ok = await onSave({ name: name.trim(), color, icon, status_id: statusId });
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Modal
      title={editing ? "Edit project" : "New project"}
      onClose={onClose}
      footer={
        <>
          <Button className="ml-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!valid || saving}>
            <Check size={16} /> {editing ? "Save" : "Create"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-6">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-muted">Name</span>
          <div className="flex items-center gap-3 border-b-2 pb-1.5" style={{ borderColor: color }}>
            <span className="grid size-10 shrink-0 place-items-center" style={{ background: color, color: ON_INK }}>
              <Icon size={20} />
            </span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Thesis chapter 3"
              className="min-w-0 flex-1 bg-transparent font-serif text-xl font-semibold outline-none placeholder:font-normal placeholder:text-faint"
            />
          </div>
        </label>

        <Choice label="Status" value={statusId} onChange={setStatusId} options={statuses} />

        <fieldset>
          <legend className="mb-2 text-xs font-semibold text-muted">Color</legend>
          <div className="flex flex-wrap gap-2">
            {PROJECT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
                aria-pressed={c === color}
                className={`grid size-8 place-items-center transition-transform hover:scale-110 ${
                  c === color ? "outline-2 outline-offset-2" : ""
                }`}
                style={{ background: c, color: ON_INK, outlineColor: c }}
              >
                {c === color && <Check size={15} strokeWidth={3} />}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-xs font-semibold text-muted">Icon</legend>
          <div className="grid grid-cols-6 border-t border-l border-rule sm:grid-cols-8">
            {Object.entries(PROJECT_ICONS).map(([key, I]) => {
              const selected = key === icon;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setIcon(key)}
                  aria-label={`Icon ${key}`}
                  aria-pressed={selected}
                  className={`grid aspect-square place-items-center border-r border-b border-rule transition-colors ${
                    selected ? "" : "text-muted hover:bg-surface-2 hover:text-text"
                  }`}
                  style={selected ? { background: tint(color, 16), color: inkText(color) } : undefined}
                >
                  <I size={19} />
                </button>
              );
            })}
          </div>
        </fieldset>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/** A single choice from a short list, shown as ink-marked words. */
function Choice({ label, value, onChange, options }) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold text-muted">{label}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1" role="radiogroup" aria-label={label}>
        {options.map((o) => {
          const active = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.id)}
              className={`inline-flex h-7 items-center gap-1.5 border-b-2 text-[13px] transition-colors ${
                active ? "text-text" : "border-transparent text-muted hover:text-text"
              }`}
              style={active ? { borderColor: o.color ? inkText(inkFor(o.color)) : "var(--text)" } : undefined}
            >
              {o.color && <span className="size-2 shrink-0" style={{ background: inkFor(o.color) }} aria-hidden="true" />}
              <span className="max-w-[10rem] truncate">{o.name}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
