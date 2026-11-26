import { useEffect, useState } from "react";
import { formatDistanceToNow } from "../lib/dates";
import { Archive, ArchiveRestore, Check, ChevronDown, CloudDownload, Flame, Pencil, Plus, RefreshCw, Target, Trash2 } from "lucide-react";
import Modal, { Button } from "./Modal";
import { dayKey, fmtEntry, fmtTarget, isActive, lastDays, streakOf } from "../lib/habits";
import { __, __r, _n } from "../i18n";

const STRIP = 28; // days shown in a habit's strip
const GREEN = "#3a744b";
const fieldClass = "h-10 w-full min-w-0 border-0 border-b border-line-strong bg-transparent px-0 text-[14px] outline-none transition-colors focus:border-b-2 focus:border-accent-2";
const labelClass = "mb-1 block text-xs font-semibold text-muted";

/**
 * The Habits tab: habits from two places, said on each row. Ones added from the My Habits app's newest backup on Google
 * Drive ("Drive") are read here, not edited: tick a day off in My Habits, export a backup to the Drive folder, and "Sync from
 * Drive" brings it in; "Add from Drive" chooses which of them to keep here. Ones made here ("In-app", also called
 * continuous tasks) are edited and logged on this tab: click a day's square to say how it went. Each habit shows its
 * streak, the last four weeks and, for a counted or timed one, the last value.
 *
 * `actions` is { listDrive, importFromDrive, create, update, remove, setDay } (see useHabits); `onSync` syncs.
 */
export default function HabitsView({ habits, status, configured, canSetUp = true, syncedAt, sourceFile, syncing, error, onSync, actions, today }) {
  const [result, setResult] = useState(null); // what the last sync or import said: { ok, message }
  const [showOld, setShowOld] = useState(false);
  const [form, setForm] = useState(null); // the new-habit window: {} to make one, { habit } to edit one
  const [driveOpen, setDriveOpen] = useState(false);
  const active = habits.filter(isActive);
  const old = habits.filter((h) => !isActive(h));
  const fromDrive = habits.filter((h) => h.source === "drive");

  const sync = async (force = false) => {
    setResult(null);
    setResult(await onSync({ force }));
  };

  const rowProps = (h) => ({
    habit: h,
    today,
    onDay: (day, body) => actions.setDay(h.id, day, body),
    onEdit: () => setForm({ habit: h }),
    onArchive: () => actions.update(h.id, { archived: !h.archived }),
    onRemove: () => actions.remove(h.id),
  });

  return (
    <section className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="font-serif text-[17px] font-semibold">{__("Habits")}</h2>
        <span className="font-serif text-xs italic text-muted">
          {_n(active.length, "{n} habit", "{n} habits")}
          {syncedAt && fromDrive.length > 0 && `, ${__("Drive synced {when}", { when: formatDistanceToNow(new Date(syncedAt), { addSuffix: true }) })}${sourceFile ? ` ${__("from {file}", { file: sourceFile })}` : ""}`}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {configured && (
            <button
              onClick={() => setDriveOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 border border-line-strong px-2.5 text-xs font-semibold transition-colors hover:border-text hover:bg-surface-2"
              title={__("Choose which habits from the My Habits backup in the Drive folder to keep here")}
            >
              <CloudDownload size={14} aria-hidden="true" />
              {__("Add from Drive")}
            </button>
          )}
          {configured && fromDrive.length > 0 && (
            <button
              onClick={() => sync(false)}
              disabled={syncing}
              className="inline-flex h-8 items-center gap-1.5 border border-line-strong px-2.5 text-xs font-semibold transition-colors hover:border-text hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50"
              title={__("Update the habits added from Drive with the newest My Habits backup")}
            >
              <RefreshCw size={14} aria-hidden="true" className={syncing ? "blink-dot" : ""} />
              {syncing ? __("Syncing…") : __("Sync from Drive")}
            </button>
          )}
          <button
            onClick={() => setForm({})}
            className="inline-flex h-8 items-center gap-1.5 border border-text bg-text px-2.5 text-xs font-semibold text-bg transition-opacity hover:opacity-90"
          >
            <Plus size={14} aria-hidden="true" />
            {__("New habit")}
          </button>
        </span>
      </div>
      <p className="mt-0.5 mb-3 text-[13px] text-muted">
        {__("Habits you make here (In-app) are logged on this tab: click a day's square. Habits added from the My Habits app (Drive) are only read here: log a day in the app, export a backup to the Drive folder, then sync.")}
      </p>
      {result && (
        <p role="status" className={`mb-3 text-[13px] ${result.ok ? "text-muted" : "text-danger"}`}>
          {result.message}
          {!result.ok && configured && fromDrive.length > 0 && (
            <button onClick={() => sync(true)} className="ml-2 underline underline-offset-2 hover:text-text">{__("Try again")}</button>
          )}
        </p>
      )}
      {error && <p role="alert" className="mb-3 text-[13px] text-danger">{error}</p>}

      {status === "error" && <p className="font-serif text-sm italic text-muted">{__("Couldn't load the habits. Reload the page to try again.")}</p>}

      {status !== "error" && habits.length === 0 && status === "ready" && (
        <div className="border border-dashed border-line-strong p-6 text-center">
          <Target size={22} className="mx-auto text-faint" aria-hidden="true" />
          <p className="mt-3 font-serif text-lg font-semibold">{__("No habits yet")}</p>
          <p className="mt-1 text-[13px] text-muted">
            {configured
              ? __r("Press {add} to make one, or {drive} to choose some from your My Habits backup. In My Habits, export a full backup to the Drive folder first if you haven't.", {
                  add: <b>{__("New habit")}</b>,
                  drive: <b>{__("Add from Drive")}</b>,
                })
              : __r("Press {add} to make one.", { add: <b>{__("New habit")}</b> })}
          </p>
          {!configured && canSetUp && (
            <p className="mt-3 text-xs text-faint">
              {__r("To add habits from My Habits, set {folder} and {json} on the server (see .env.example) and share the Drive folder with that service account.", {
                folder: <code>GOOGLE_DRIVE_FOLDER_ID</code>,
                json: <code>GOOGLE_SERVICE_ACCOUNT_JSON</code>,
              })}
            </p>
          )}
        </div>
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {active.map((h) => (
          <HabitRow key={h.id} {...rowProps(h)} />
        ))}
        {old.length > 0 && (
          <li className="list-none">
            <button
              onClick={() => setShowOld((s) => !s)}
              aria-expanded={showOld}
              className="mt-2 flex items-center gap-1.5 py-1 text-[13px] text-muted transition-colors hover:text-text"
            >
              <ChevronDown size={15} className={`transition-transform ${showOld ? "" : "-rotate-90"}`} />
              {__("Archived or removed")} <span className="figures text-xs">({old.length})</span>
            </button>
            {showOld && (
              <ul>
                {old.map((h) => (
                  <HabitRow key={h.id} {...rowProps(h)} muted />
                ))}
              </ul>
            )}
          </li>
        )}
      </ul>

      {form && (
        <HabitForm
          habit={form.habit}
          onClose={() => setForm(null)}
          onSave={(body) => (form.habit ? actions.update(form.habit.id, body) : actions.create(body))}
        />
      )}
      {driveOpen && (
        <DriveHabits
          load={actions.listDrive}
          onClose={() => setDriveOpen(false)}
          onImport={async (uuids) => {
            setResult(null);
            setDriveOpen(false);
            setResult(await actions.importFromDrive(uuids));
          }}
        />
      )}
    </section>
  );
}

/** The next thing a click on a day of a yes/no habit says: nothing -> yes -> no -> skip -> nothing. */
const NEXT_STATE = { none: "yes", done: "no", missed: "skip", skip: "unknown" };

function HabitRow({ habit, today, muted = false, onDay, onEdit, onArchive, onRemove }) {
  const [editing, setEditing] = useState(null); // the day (key) of a counted habit whose number is being typed
  const [sure, setSure] = useState(false); // asked "remove it?"
  const mine = habit.source === "app";
  const days = lastDays(habit, STRIP, today);
  const streak = streakOf(habit, today);
  const target = fmtTarget(habit);
  const latest = [...habit.entries].sort((a, b) => b.entry_date.localeCompare(a.entry_date)).find((e) => e.status === "value");
  const doneToday = days[days.length - 1];

  const clickDay = (d) => {
    if (habit.value_type === "numerical") return setEditing(editing === d.key ? null : d.key);
    onDay(d.key, { status: NEXT_STATE[d.state] });
  };

  return (
    <li className={`border-b border-rule py-3 ${muted ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h3 className="min-w-0 font-serif text-[15px] font-semibold">{habit.name}</h3>
        <span
          className="shrink-0 border border-line px-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted"
          title={mine ? __("Made here: click a day's square to log it") : __("From My Habits on Drive: read-only here")}
        >
          {mine ? __("In-app") : __("Drive")}
        </span>
        {habit.question && <span className="min-w-0 truncate text-[13px] text-muted">{habit.question}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-3 text-xs text-muted">
          {target && (
            <span className="inline-flex items-center gap-1" title={__("The target")}>
              <Target size={12} aria-hidden="true" /> {target}
            </span>
          )}
          {habit.value_type !== "boolean" && latest && (
            <span title={__("Last logged on {entry_date}", { entry_date: latest.entry_date })}>
              {__("last")} <span className="figures font-semibold text-text">{fmtEntry(habit, latest)}</span>
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1 ${streak > 0 ? "font-semibold text-accent" : ""}`}
            title={doneToday.state === "none" ? __("Streak up to yesterday: today isn't logged yet") : __("Days in a row")}
          >
            <Flame size={13} aria-hidden="true" />
            <span className="figures">{streak}</span>
            <span className="sr-only">{__("day streak")}</span>
          </span>
        </span>
      </div>
      <ol className="mt-2 flex gap-[3px]" aria-label={__("{name}, the last {STRIP} days", { name: habit.name, STRIP })}>
        {days.map((d) => {
          const style = {
            background: d.state === "done" ? GREEN : d.state === "skip" ? "color-mix(in srgb, var(--muted) 35%, transparent)" : undefined,
          };
          const look = `h-4 min-w-0 flex-1 ${d.state === "none" ? "border border-rule" : d.state === "missed" ? "border border-line-strong" : ""}`;
          const title = `${d.key}${d.key === dayKey(today) ? ` (${__("today")})` : ""}: ${fmtEntry(habit, d.entry)}`;
          return (
            <li key={d.key} className="flex min-w-0 flex-1">
              {mine && !muted ? (
                <button
                  type="button"
                  onClick={() => clickDay(d)}
                  title={`${title}. ${habit.value_type === "numerical" ? __("Click to enter a number") : __("Click to change")}`}
                  aria-label={title}
                  className={`${look} w-full cursor-pointer transition-opacity hover:opacity-70 ${editing === d.key ? "outline-2 outline-offset-1 outline-text" : ""}`}
                  style={style}
                />
              ) : (
                <span title={title} className={`${look} w-full`} style={style} />
              )}
            </li>
          );
        })}
      </ol>

      {editing && (
        <DayValue
          habit={habit}
          day={editing}
          entry={habit.entries.find((e) => e.entry_date === editing)}
          onSave={async (body) => {
            if (await onDay(editing, body)) setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
        {mine && (
          <>
            <RowButton onClick={onEdit} icon={Pencil} label={__("Edit")} />
            <RowButton onClick={onArchive} icon={habit.archived ? ArchiveRestore : Archive} label={habit.archived ? __("Restore") : __("Archive")} title={habit.archived ? __("Put it back among the active habits") : __("Stop showing it among the active habits; its days are kept")} />
          </>
        )}
        {sure ? (
          <span className="inline-flex items-center gap-1 text-danger">
            {mine ? __("Delete it and its days?") : __("Remove it from here?")}
            <button onClick={onRemove} className="h-7 px-2 font-semibold underline underline-offset-2 hover:bg-danger/10">{__("Yes")}</button>
            <button onClick={() => setSure(false)} className="h-7 px-2 text-muted hover:text-text">{__("No")}</button>
          </span>
        ) : (
          <RowButton
            onClick={() => setSure(true)}
            icon={Trash2}
            label={mine ? __("Delete") : __("Remove")}
            title={mine ? __("Delete this habit and its days") : __("Take it out of the tracker; it stays in My Habits and can be added again from Drive")}
            danger
          />
        )}
      </div>
    </li>
  );
}

function RowButton({ icon: Icon, label, title, danger = false, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      className={`inline-flex h-7 items-center gap-1.5 px-2 font-semibold text-muted transition-colors hover:bg-surface-2 ${danger ? "hover:text-danger" : "hover:text-text"}`}
    >
      <Icon size={13} aria-hidden="true" />
      {label}
    </button>
  );
}

/** Type the number for one day of a counted habit. */
function DayValue({ habit, day, entry, onSave, onClose }) {
  const [text, setText] = useState(entry?.status === "value" ? String(entry.value) : "");
  const number = Number(text);
  const valid = text.trim() !== "" && Number.isFinite(number) && number >= 0;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave({ status: "value", value: number });
      }}
      className="mt-2 flex flex-wrap items-center gap-2 border border-dashed border-line-strong px-3 py-2"
    >
      <label className="flex items-center gap-2 text-[13px]">
        <span className="text-muted">{__("{day}: how much?", { day })}</span>
        <input
          autoFocus
          type="number"
          min={0}
          step="any"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="figures h-8 w-24 border-0 border-b border-line-strong bg-transparent px-0 text-[14px] outline-none focus:border-b-2 focus:border-accent-2"
        />
        {habit.unit && <span className="text-muted">{habit.unit}</span>}
      </label>
      <Button type="submit" variant="outline" disabled={!valid}>
        <Check size={14} />{" "}{__("Save")}</Button>
      <Button type="button" onClick={() => onSave({ status: "skip" })}>{__("Skip")}</Button>
      <Button type="button" onClick={() => onSave({ status: "unknown" })} disabled={!entry}>{__("Clear")}</Button>
      <button type="button" onClick={onClose} className="ml-auto h-8 px-2 text-xs text-muted hover:text-text">{__("Close")}</button>
    </form>
  );
}

/** Make a habit here, or edit one made here. What kind it is (yes/no or a number) is chosen when it is made. */
function HabitForm({ habit, onSave, onClose }) {
  const editing = Boolean(habit);
  const [name, setName] = useState(habit?.name ?? "");
  const [question, setQuestion] = useState(habit?.question ?? "");
  const [kind, setKind] = useState(habit?.value_type ?? "boolean");
  const [unit, setUnit] = useState(habit?.unit ?? "");
  const [target, setTarget] = useState(habit?.target_value != null ? String(habit.target_value) : "");
  const [targetType, setTargetType] = useState(habit?.target_type ?? "at_least");
  const [saving, setSaving] = useState(false);
  const numerical = kind === "numerical";
  const targetNumber = Number(target);
  const validTarget = target.trim() === "" || (Number.isFinite(targetNumber) && targetNumber > 0);
  const valid = name.trim().length > 0 && validTarget;

  const submit = async (e) => {
    e?.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    const body = { name: name.trim(), question: question.trim() };
    if (numerical) {
      body.unit = unit.trim();
      body.target_value = target.trim() === "" ? null : targetNumber;
      body.target_type = target.trim() === "" ? null : targetType;
    }
    if (!editing) body.value_type = kind;
    const ok = await onSave(body);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Modal
      title={editing ? __("Edit habit") : __("New habit")}
      onClose={onClose}
      footer={
        <>
          <Button className="ml-auto" onClick={onClose}>{__("Cancel")}</Button>
          <Button variant="primary" onClick={submit} disabled={!valid || saving}>
            <Check size={16} /> {editing ? __("Save") : __("Create")}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <label className="block">
          <span className={labelClass}>{__("Name")}</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={__("Stretch")} className={fieldClass} />
        </label>
        <label className="block">
          <span className={labelClass}>{__("Question (optional)")}</span>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} placeholder={__("Did you stretch today?")} className={fieldClass} />
        </label>
        <fieldset>
          <legend className={labelClass}>{__("How is a day logged?")}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1" role="radiogroup" aria-label={__("How is a day logged?")}>
            {[["boolean", __("Yes or no")], ["numerical", __("A number")]].map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={kind === id}
                disabled={editing}
                onClick={() => setKind(id)}
                className={`inline-flex h-7 items-center border-b-2 text-[13px] transition-colors disabled:cursor-not-allowed ${
                  kind === id ? "border-text text-text" : "border-transparent text-muted enabled:hover:text-text"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {editing && <p className="mt-1 text-xs text-faint">{__("It can't change once the habit is made.")}</p>}
        </fieldset>
        {numerical && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            <label className="block">
              <span className={labelClass}>{__("Unit (optional)")}</span>
              <input value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={40} placeholder={__("glasses")} className={fieldClass} />
            </label>
            <label className="block">
              <span className={labelClass}>{__("Target (optional)")}</span>
              <div className="flex items-end gap-2">
                <select
                  value={targetType}
                  onChange={(e) => setTargetType(e.target.value)}
                  aria-label={__("At least or at most")}
                  className="h-10 border-0 border-b border-line-strong bg-transparent text-[13px] outline-none"
                >
                  <option value="at_least">{__("at least")}</option>
                  <option value="at_most">{__("at most")}</option>
                </select>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="8"
                  className={`${fieldClass} figures`}
                />
              </div>
            </label>
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/** Choose which habits of the newest My Habits backup on Drive to keep here. Habits already added are shown ticked. */
function DriveHabits({ load, onImport, onClose }) {
  const [list, setList] = useState(null); // { file_name, habits } once loaded
  const [error, setError] = useState("");
  const [picked, setPicked] = useState(() => new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    load()
      .then((found) => alive && setList(found))
      .catch((e) => alive && setError(e.message || __("Couldn't read the backup")));
    return () => {
      alive = false;
    };
  }, [load]);

  const toggle = (uuid) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(uuid)) next.add(uuid);
      return next;
    });
  const submit = async () => {
    setSaving(true);
    await onImport([...picked]);
  };

  return (
    <Modal
      title={__("Add habits from Drive")}
      onClose={onClose}
      footer={
        <>
          <Button className="ml-auto" onClick={onClose}>{__("Cancel")}</Button>
          <Button variant="primary" onClick={submit} disabled={picked.size === 0 || saving}>
            <Check size={16} /> {picked.size > 0 ? _n(picked.size, "Add {n} habit", "Add {n} habits") : __("Add")}
          </Button>
        </>
      }
    >
      {!list && !error && <p className="font-serif text-sm italic text-muted">{__("Reading the newest backup…")}</p>}
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      {list && (
        <>
          <p className="text-xs text-muted">{__r("From {file}. Pick the habits to keep here: they stay read-only, and “Sync from Drive” keeps them up to date.", { file: <b>{list.file_name}</b> })}</p>
          <ul className="mt-3 border-t border-rule">
            {list.habits.map((h) => (
              <li key={h.uuid} className="border-b border-rule">
                <label className={`flex h-10 items-center gap-3 px-1 text-[14px] ${h.imported ? "text-muted" : "cursor-pointer hover:bg-surface-2"}`}>
                  <input
                    type="checkbox"
                    checked={h.imported || picked.has(h.uuid)}
                    disabled={h.imported}
                    onChange={() => toggle(h.uuid)}
                    className="size-4 shrink-0 cursor-pointer accent-(--text) disabled:cursor-not-allowed"
                  />
                  <span className="min-w-0 flex-1 truncate">{h.name}</span>
                  {h.archived && <span className="shrink-0 font-serif text-xs italic">{__("archived there")}</span>}
                  {h.imported && <span className="shrink-0 font-serif text-xs italic">{__("already added")}</span>}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
