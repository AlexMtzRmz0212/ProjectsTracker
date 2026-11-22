import { ArrowDown, ArrowUp, Check, GripVertical, RotateCcw } from "lucide-react";
import Modal, { Button } from "./Modal";
import { useReorder } from "../hooks/useReorder";
import { __, useT } from "../i18n";

/** Arrange the main tabs: drag a handle, or use the arrows (which are also there for a touch screen). The order saves
 *  as you change it, and is kept in this browser. `tabs` are the tabs in their current order; `onChange` gets every id in
 *  the new order; `onReset` goes back to the usual one. */
export default function TabOrderModal({ tabs, onChange, onReset, onClose }) {
  useT();
  const reorder = useReorder(tabs.map((t) => t.id), onChange);

  const move = (i, by) => {
    const ids = tabs.map((t) => t.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    onChange(ids);
  };

  const arrow = "grid size-8 shrink-0 place-items-center text-muted transition-colors enabled:hover:bg-surface-2 enabled:hover:text-text disabled:cursor-not-allowed disabled:opacity-30";

  return (
    <Modal
      title={__("Tab order")}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onReset}>
            <RotateCcw size={15} />{" "}{__("Usual order")}</Button>
          <Button variant="primary" className="ml-auto" onClick={onClose}>
            <Check size={16} />{" "}{__("Done")}</Button>
        </>
      }
    >
      <p className="text-xs text-muted">{__("Drag a handle, or use the arrows, to put the tabs in the order you want. It is saved in this browser, and the first tab is the one the app opens on.")}</p>

      <ul className={`mt-3 border-t border-rule ${reorder.held ? "select-none" : ""}`}>
        {tabs.map((item, i) => {
          const Icon = item.icon;
          const row = reorder.rowProps(i);
          return (
            <li key={item.id} {...row} className={`border-b border-rule ${row.className ?? "bg-surface"}`}>
              <div className="flex items-center gap-1.5 py-1">
                <button
                  {...reorder.gripProps(item.id, i)}
                  aria-label={__("Move {name}: drag, or use the up and down arrow keys", { name: item.label })}
                  title={__("Drag to reorder")}
                  className={`-ml-1 grid h-8 w-5 shrink-0 touch-none place-items-center text-faint transition-colors hover:text-text ${
                    reorder.held === item.id ? "cursor-grabbing text-text" : "cursor-grab"
                  }`}
                >
                  <GripVertical size={15} />
                </button>
                <Icon size={16} className="shrink-0" style={{ color: item.color }} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[14px]">{item.label}</span>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className={arrow} aria-label={__("Move {name} up", { name: item.label })} title={__("Move up")}>
                  <ArrowUp size={15} />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === tabs.length - 1} className={arrow} aria-label={__("Move {name} down", { name: item.label })} title={__("Move down")}>
                  <ArrowDown size={15} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
