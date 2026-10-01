import { useState } from "react";
import { Check } from "lucide-react";
import Modal, { Button } from "./Modal";
import { ON_INK, PROJECT_COLORS, PROJECT_ICONS, iconFor, inkText, tint } from "../lib/palette";

/** Create or edit a project: name, ink, icon, with a live preview of its ledger line. */
export default function ProjectModal({ project, usedColors, onClose, onSave }) {
  const editing = Boolean(project);
  const [name, setName] = useState(project?.name ?? "");
  const [color, setColor] = useState(
    project?.color ?? PROJECT_COLORS.find((c) => !usedColors.includes(c)) ?? PROJECT_COLORS[0]
  );
  const [icon, setIcon] = useState(project?.icon ?? "code");
  const [saving, setSaving] = useState(false);
  const Icon = iconFor(icon);
  const valid = name.trim().length > 0;

  const submit = async (e) => {
    e?.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    const ok = await onSave({ name: name.trim(), color, icon });
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
