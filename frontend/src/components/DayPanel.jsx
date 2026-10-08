import { format } from "date-fns";
import { CalendarPlus, Check, Hourglass, Moon, Pencil, Plus, Square, Trash2 } from "lucide-react";
import { iconFor, inkText } from "../lib/palette";
import { completedPomodoros, dayKey, fmtHM, fmtTime, pomodoroProjects, pomodorosOnDay, sessionSeconds } from "../lib/time";
import { SplitBar } from "./StatsStrip";
import ParentTag from "./ParentTag";

/** The selected day as a time card: In, Out, Project, Hours, then the pomodoros finished and the to-dos ticked off that day.
 *  An open item (`openItem` on a session still going) is listed with the rest, to edit or close (`onStop(session)`). */
export default function DayPanel({ date, sessions, pomodoros, todos, byDay, projectsById, now, onAdd, onEdit, onDelete, onStop }) {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  const entry = byDay.get(dayKey(date));
  const total = entry?.total ?? 0;

  const daySessions = sessions
    .filter((s) => projectsById.has(s.project_id) && s.start < dayEnd && (s.end ?? now) > dayStart)
    .sort((a, b) => a.start - b.start);

  const dayPomodoros = pomodorosOnDay(pomodoros, date);

  const todosById = new Map(todos.map((x) => [x.id, x]));

  // Whether or not a timer was running when they were ticked
  const ticked = todos
    .filter((x) => x.done && x.completed_at && projectsById.has(x.project_id))
    .map((x) => ({ ...x, at: new Date(x.completed_at) }))
    .filter((x) => x.at >= dayStart && x.at < dayEnd)
    .sort((a, b) => a.at - b.at);

  return (
    <section className="border-t border-line pt-5 lg:border-t-0 lg:pt-0">
      <div className="flex items-center gap-3">
        <h2 className="min-w-0 truncate font-serif text-[17px] font-semibold">
          <span className="sm:hidden">{format(date, "EEE d MMM")}</span>
          <span className="max-sm:hidden">{format(date, "EEEE d MMMM")}</span>{" "}
          <span className="figures font-normal text-muted">{format(date, "yyyy")}</span>
        </h2>
        <span className="figures ml-auto shrink-0 text-[15px] font-semibold">{fmtHM(total)}</span>
        <button
          onClick={onAdd}
          className="grid size-8 shrink-0 place-items-center border border-line-strong text-muted transition-colors hover:border-text hover:text-text"
          aria-label="Add a session on this day"
          title="Add time"
        >
          <Plus size={16} />
        </button>
      </div>

      {total > 0 && (
        <div className="mt-3">
          <SplitBar byProject={entry.byProject} projectsById={projectsById} className="h-1" />
        </div>
      )}

      {daySessions.length === 0 ? (
        <button
          onClick={onAdd}
          className="mt-3 flex w-full items-center justify-center gap-2 border border-dashed border-line-strong py-6 text-[13px] text-muted transition-colors hover:border-text hover:text-text"
        >
          <CalendarPlus size={17} />
          <span>
            No time logged. <span className="font-semibold text-text underline underline-offset-2">Add time</span>
          </span>
        </button>
      ) : (
        <table className="mt-3 w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-rule text-left font-serif text-xs italic text-muted">
              <th className="py-1 pr-3 font-normal">In</th>
              <th className="py-1 pr-3 font-normal">Out</th>
              <th className="py-1 pr-3 font-normal">Project</th>
              <th className="py-1 text-right font-normal">Hours</th>
              <th className="w-0 py-1">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {daySessions.map((s) => {
              const project = projectsById.get(s.project_id);
              const Icon = iconFor(project.icon);
              const running = !s.end;
              const crossesMidnight = s.start < dayStart || (s.end ?? now) > dayEnd;
              return (
                <tr key={s.id} className="group h-9 border-b border-rule">
                  <td className="figures pr-3 whitespace-nowrap">{fmtTime(s.start)}</td>
                  <td className="figures pr-3 whitespace-nowrap">
                    {running && s.openItem ? (
                      <span className="inline-flex items-center gap-1.5 font-semibold text-accent-2" title="Open: close it when it's done">
                        <Hourglass size={12} aria-hidden="true" />
                        open
                      </span>
                    ) : running ? (
                      <span className="inline-flex items-center gap-1.5 font-semibold text-accent">
                        <span className="blink-dot size-1.5 rounded-full bg-accent" aria-hidden="true" />
                        now
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        {fmtTime(s.end)}
                        {crossesMidnight && <Moon size={11} className="text-muted" aria-label="Crosses midnight" />}
                      </span>
                    )}
                  </td>
                  <td className="w-full max-w-0 pr-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon size={14} className="shrink-0" style={{ color: inkText(project.color) }} aria-hidden="true" />
                      <span className="truncate">{project.name}</span>
                      {s.todo_id && todosById.has(s.todo_id) && project.kind !== "task" && (
                        <span className="min-w-0 shrink truncate text-muted" title={`On "${todosById.get(s.todo_id).text}"`}>
                          · {todosById.get(s.todo_id).text}
                        </span>
                      )}
                      {/* the note only takes what the project name leaves over */}
                      {s.note && (
                        <span className="min-w-0 flex-1 basis-0 truncate font-serif text-xs italic text-muted">{s.note}</span>
                      )}
                    </div>
                  </td>
                  <td className={`figures text-right whitespace-nowrap ${running ? "font-semibold" : ""}`}>
                    {fmtHM(sessionSeconds(s, now))}
                  </td>
                  <td className="pl-2">
                    <div className="flex justify-end gap-0.5 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                      {running && s.openItem ? (
                        <>
                          <RowButton label="Edit the open item" onClick={() => onEdit(s)}>
                            <Pencil size={14} />
                          </RowButton>
                          <RowButton label="Close it now" onClick={() => onStop(s)}>
                            <Check size={14} />
                          </RowButton>
                        </>
                      ) : running ? (
                        <RowButton label="Stop timer" onClick={() => onStop(s)}>
                          <Square size={12} fill="currentColor" />
                        </RowButton>
                      ) : (
                        <>
                          <RowButton label="Edit session" onClick={() => onEdit(s)}>
                            <Pencil size={14} />
                          </RowButton>
                          <RowButton label="Delete session" onClick={() => onDelete(s)} danger>
                            <Trash2 size={14} />
                          </RowButton>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {dayPomodoros.length > 0 && (
        <div className="mt-5">
          <h3 className="flex items-baseline gap-2 border-b border-rule py-1 text-left font-serif text-xs font-normal italic text-muted">
            Pomodoros <span className="figures not-italic">{completedPomodoros(dayPomodoros).length}</span>
          </h3>
          <ul>
            {dayPomodoros.map((p) => {
              // Longest first; a project that is gone (deleted) has nothing left to name
              const worked = [...pomodoroProjects(p, sessions, now)]
                .filter(([id]) => projectsById.has(id))
                .sort((a, b) => b[1] - a[1]);
              return (
                <li key={p.id} className="flex min-h-9 items-center gap-3 border-b border-rule py-1 text-[13px]">
                  <span className={`figures shrink-0 whitespace-nowrap ${p.completed ? "" : "text-muted"}`}>
                    {fmtTime(p.start)}–{fmtTime(p.end)}
                  </span>
                  {!p.completed && <span className="shrink-0 font-serif text-xs italic text-muted">cut short</span>}
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
                    {worked.length === 0 && <span className="font-serif text-xs italic text-muted">no project timer</span>}
                    {worked.map(([id, secs]) => {
                      const project = projectsById.get(id);
                      const Icon = iconFor(project.icon);
                      return (
                        <span key={id} className="flex min-w-0 items-center gap-1.5" title={project.name}>
                          <Icon size={14} className="shrink-0" style={{ color: inkText(project.color) }} aria-hidden="true" />
                          <span className="max-w-[9rem] truncate max-sm:sr-only">{project.name}</span>
                          <span className="figures shrink-0 text-muted">{fmtHM(secs)}</span>
                        </span>
                      );
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {ticked.length > 0 && (
        <div className="mt-5">
          <h3 className="border-b border-rule py-1 text-left font-serif text-xs font-normal italic text-muted">Ticked off</h3>
          <ul>
            {ticked.map((x) => {
              const project = projectsById.get(x.project_id);
              const Icon = iconFor(project.icon);
              return (
                <li key={x.id} className="flex min-h-9 items-center gap-3 border-b border-rule py-1 text-[13px]">
                  <span className="figures shrink-0 whitespace-nowrap text-muted">{fmtTime(x.at)}</span>
                  <Check size={13} className="shrink-0 text-muted" aria-hidden="true" />
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="min-w-0 break-words">{x.text}</span>
                    <ParentTag todo={x} todosById={todosById} />
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-muted" title={project.name}>
                    <Icon size={14} style={{ color: inkText(project.color) }} aria-hidden="true" />
                    <span className="max-w-[9rem] truncate max-sm:sr-only">{project.name}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function RowButton({ label, onClick, danger, children }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`grid size-7 place-items-center text-muted transition-colors hover:bg-surface-2 ${
        danger ? "hover:text-danger" : "hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}
