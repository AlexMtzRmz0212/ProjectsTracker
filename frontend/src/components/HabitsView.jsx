import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ChevronDown, CloudDownload, Flame, Target } from "lucide-react";
import { dayKey, fmtEntry, fmtTarget, isActive, lastDays, streakOf } from "../lib/habits";

const STRIP = 28; // days shown in a habit's strip
const GREEN = "#3a744b";

/**
 * The Habits tab: the habits kept in the My Habits app, as of its newest backup on Google Drive. They are read
 * here, not edited: tick a day off in My Habits, export a backup to the Drive folder, and "Sync from Drive"
 * brings it in. Each habit shows its streak, the last four weeks and, for a counted or timed one, the last value.
 */
export default function HabitsView({ habits, status, configured, syncedAt, sourceFile, syncing, onSync, today }) {
  const [result, setResult] = useState(null); // what the last sync said: { ok, message }
  const [showOld, setShowOld] = useState(false);
  const active = habits.filter(isActive);
  const old = habits.filter((h) => !isActive(h));

  const sync = async (force = false) => {
    setResult(null);
    setResult(await onSync({ force }));
  };

  return (
    <section className="flex h-full flex-col">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-serif text-[17px] font-semibold">Habits</h2>
        <span className="font-serif text-xs italic text-muted">
          {syncedAt
            ? `${active.length} ${active.length === 1 ? "habit" : "habits"}, synced ${formatDistanceToNow(new Date(syncedAt), { addSuffix: true })}${sourceFile ? ` from ${sourceFile}` : ""}`
            : configured
              ? "Not synced yet"
              : active.length > 0
                ? "Sample habits"
                : ""}
        </span>
        {configured && (
          <button
            onClick={() => sync(false)}
            disabled={syncing}
            className="ml-auto inline-flex h-8 items-center gap-1.5 border border-line-strong px-2.5 text-xs font-semibold transition-colors hover:border-text hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50"
            title="Copy the newest My Habits backup in the Drive folder into the tracker"
          >
            <CloudDownload size={14} aria-hidden="true" className={syncing ? "blink-dot" : ""} />
            {syncing ? "Syncing…" : "Sync from Drive"}
          </button>
        )}
      </div>
      <p className="mt-0.5 mb-3 text-[13px] text-muted">
        Your habits from the My Habits app. They are only read here: log a day in the app, export a backup to the Drive
        folder, then sync.
      </p>
      {result && (
        <p role="status" className={`mb-3 text-[13px] ${result.ok ? "text-muted" : "text-danger"}`}>
          {result.message}
          {!result.ok && configured && (
            <button onClick={() => sync(true)} className="ml-2 underline underline-offset-2 hover:text-text">
              Try again
            </button>
          )}
        </p>
      )}

      {status === "error" && <p className="font-serif text-sm italic text-muted">Couldn't load the habits. Reload the page to try again.</p>}

      {status !== "error" && habits.length === 0 && status === "ready" && (
        <div className="border border-dashed border-line-strong p-6 text-center">
          <Target size={22} className="mx-auto text-faint" aria-hidden="true" />
          {configured ? (
            <>
              <p className="mt-3 font-serif text-lg font-semibold">No habits yet</p>
              <p className="mt-1 text-[13px] text-muted">
                Press <b>Sync from Drive</b> to bring in the newest backup. In My Habits, export a full backup to the Drive
                folder first if you haven't.
              </p>
            </>
          ) : (
            <>
              <p className="mt-3 font-serif text-lg font-semibold">Drive sync isn't set up</p>
              <p className="mt-1 text-[13px] text-muted">
                On the server, set <code>GOOGLE_DRIVE_FOLDER_ID</code> and <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> (see
                .env.example). The Drive folder holding the My Habits backups must be shared with that service account.
              </p>
            </>
          )}
        </div>
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {active.map((h) => (
          <HabitRow key={h.id} habit={h} today={today} />
        ))}
        {old.length > 0 && (
          <li className="list-none">
            <button
              onClick={() => setShowOld((s) => !s)}
              aria-expanded={showOld}
              className="mt-2 flex items-center gap-1.5 py-1 text-[13px] text-muted transition-colors hover:text-text"
            >
              <ChevronDown size={15} className={`transition-transform ${showOld ? "" : "-rotate-90"}`} />
              Archived or removed <span className="figures text-xs">({old.length})</span>
            </button>
            {showOld && (
              <ul>
                {old.map((h) => (
                  <HabitRow key={h.id} habit={h} today={today} muted />
                ))}
              </ul>
            )}
          </li>
        )}
      </ul>
    </section>
  );
}

function HabitRow({ habit, today, muted = false }) {
  const days = lastDays(habit, STRIP, today);
  const streak = streakOf(habit, today);
  const target = fmtTarget(habit);
  const latest = [...habit.entries].sort((a, b) => b.entry_date.localeCompare(a.entry_date)).find((e) => e.status === "value");
  const doneToday = days[days.length - 1];
  return (
    <li className={`border-b border-rule py-3 ${muted ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h3 className="min-w-0 font-serif text-[15px] font-semibold">{habit.name}</h3>
        {habit.question && <span className="min-w-0 truncate text-[13px] text-muted">{habit.question}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-3 text-xs text-muted">
          {target && (
            <span className="inline-flex items-center gap-1" title="The target">
              <Target size={12} aria-hidden="true" /> {target}
            </span>
          )}
          {habit.value_type !== "boolean" && latest && (
            <span title={`Last logged on ${latest.entry_date}`}>
              last <span className="figures font-semibold text-text">{fmtEntry(habit, latest)}</span>
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1 ${streak > 0 ? "font-semibold text-accent" : ""}`}
            title={doneToday.state === "none" ? "Streak up to yesterday: today isn't logged yet" : "Days in a row"}
          >
            <Flame size={13} aria-hidden="true" />
            <span className="figures">{streak}</span>
            <span className="sr-only">day streak</span>
          </span>
        </span>
      </div>
      <ol className="mt-2 flex gap-[3px]" aria-label={`${habit.name}, the last ${STRIP} days`}>
        {days.map((d) => (
          <li
            key={d.key}
            title={`${d.key}${d.key === dayKey(today) ? " (today)" : ""}: ${fmtEntry(habit, d.entry)}`}
            className={`h-4 min-w-0 flex-1 ${d.state === "none" ? "border border-rule" : d.state === "missed" ? "border border-line-strong" : ""}`}
            style={{
              background:
                d.state === "done" ? GREEN : d.state === "skip" ? "color-mix(in srgb, var(--muted) 35%, transparent)" : undefined,
            }}
          />
        ))}
      </ol>
    </li>
  );
}
