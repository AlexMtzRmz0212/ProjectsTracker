import { Trash2 } from "lucide-react";
import Modal, { Button } from "./Modal";
import { iconFor, inkText } from "../lib/palette";

/** "Are you sure?" for destructive actions, with the ledger entry that goes away. */
export default function ConfirmDialog({ title, project, primary, secondary, note, onCancel, onConfirm }) {
  const Icon = iconFor(project.icon);
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button className="ml-auto" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="solidDanger" onClick={onConfirm} autoFocus>
            <Trash2 size={15} /> Delete
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-3 border-y border-rule py-3">
        <Icon size={20} className="shrink-0" style={{ color: inkText(project.color) }} />
        <div className="min-w-0 flex-1 truncate font-serif text-[15px] font-medium">{primary}</div>
        <div className="figures shrink-0 text-[15px] font-semibold text-danger">{secondary}</div>
      </div>
      {note && <p className="mt-3 text-[13px] text-muted">{note}</p>}
    </Modal>
  );
}
