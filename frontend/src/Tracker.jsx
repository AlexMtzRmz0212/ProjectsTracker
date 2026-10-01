import { useEffect, useMemo, useState } from "react";
import { format, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { CalendarDays, ChartColumn, Columns3, RotateCw, ServerOff, SlidersHorizontal } from "lucide-react";
import { useTracker } from "./hooks/useTracker";
import { useTheme } from "./hooks/useTheme";
import { useInbox } from "./hooks/useInbox";
import { useNow } from "./hooks/useNow";
import { usePomodoro } from "./hooks/usePomodoro";
import {
  aggregateByDay, dayKey, daySeconds, fmtCountdown, fmtHM, fmtTime, mostNeglected, sessionSeconds, streak, withLive,
} from "./lib/time";
import Header from "./components/Header";
import PomodoroDrawer from "./components/PomodoroDrawer";
import StatsStrip from "./components/StatsStrip";
import ProjectBoard from "./components/ProjectBoard";
import TabBar from "./components/TabBar";
import MonthCalendar from "./components/MonthCalendar";
import DayPanel from "./components/DayPanel";
import Heatmap from "./components/Heatmap";
import ProjectModal from "./components/ProjectModal";
import StatusModal from "./components/StatusModal";
import ProjectDetail from "./components/ProjectDetail";
import SessionModal from "./components/SessionModal";
import ConfirmDialog from "./components/ConfirmDialog";
import InterestInbox from "./components/InterestInbox";
import Toast from "./components/Toast";
import { Button } from "./components/Modal";
import { inkFor } from "./lib/palette";

/**
 * The whole tracker. `api` is where its data lives: the real server for the
 * owner, or the in-memory demo on the landing page. `onSignOut` (the owner's way
 * back to the public page) is never passed to the demo.
 */
export default function Tracker({ api, demo = false, onSignOut, signOutLabel }) {
  const t = useTracker(api);
  const inbox = useInbox(!demo); // the notes visitors left: only the owner's app asks for them
  const [inboxOpen, setInboxOpen] = useState(false);
  const now = useNow(Boolean(t.running));
  const todayKey = dayKey(now);
  // Keyed on the date string so "today" only changes identity at midnight, not every tick
  const today = useMemo(() => new Date(`${todayKey}T00:00:00`), [todayKey]);
  const [theme, toggleTheme] = useTheme();
  const pomodoro = usePomodoro({ running: t.running, startTimer: t.startTimer, stopTimer: t.stopTimer, scope: demo ? "demo" : "app" });
  const [pomodoroOpen, setPomodoroOpen] = useState(false);

  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => new Date());
  const [tab, setTab] = useState("projects"); // projects | calendar | stats
  const [statusesOpen, setStatusesOpen] = useState(false);
  const [detailId, setDetailId] = useState(null); // the project whose notes and to-dos are open
  const [projectModal, setProjectModal] = useState(null); // { project? }
  const [sessionModal, setSessionModal] = useState(null); // { session? , projectId?, date? }
  const [confirm, setConfirm] = useState(null); // { kind: "project" | "session", item }

  // Projects saved with a v1 neon color are shown in the nearest ledger ink.
  const projects = useMemo(() => t.projects.map((p) => ({ ...p, color: inkFor(p.color) })), [t.projects]);
  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const statusesById = useMemo(() => new Map(t.statuses.map((s) => [s.id, s])), [t.statuses]);
  const isOpen = (p) => !statusesById.get(p.status_id)?.is_done;

  const openProjects = useMemo(() => projects.filter(isOpen), [projects, statusesById]);
  // Only re-evaluated once per day (and when sessions change): "days idle" doesn't move by the second
  const neglected = useMemo(() => mostNeglected(openProjects, t.sessions, new Date(`${todayKey}T23:59:59`)), [openProjects, t.sessions, todayKey]);

  const baseByDay = useMemo(() => aggregateByDay(t.sessions), [t.sessions]);
  const byDay = useMemo(() => withLive(baseByDay, t.running, now), [baseByDay, t.running, now]);
  const elapsed = t.running ? sessionSeconds(t.running, now) : 0;
  const runningProject = t.running ? projectsById.get(t.running.project_id) : null;
  const openTodoCounts = useMemo(() => {
    const counts = new Map();
    for (const todo of t.todos) if (!todo.done) counts.set(todo.project_id, (counts.get(todo.project_id) ?? 0) + 1);
    return counts;
  }, [t.todos]);

  // Pull older sessions when the calendar is paged back past the loaded year.
  const { ensureRange } = t;
  useEffect(() => {
    ensureRange(startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }));
  }, [cursor, ensureRange]);

  const breakProject = projectsById.get(pomodoro.breakProjectId) ?? null;

  // The countdown in the browser tab, so it's visible from anywhere. The demo is
  // embedded in a page of its own, so it leaves the tab title alone.
  const { phase, focusRemaining, breakRemaining } = pomodoro;
  useEffect(() => {
    if (demo) return;
    document.title =
      phase === "focus" && runningProject ? `${fmtCountdown(focusRemaining)} · ${runningProject.name}`
      : phase === "break" ? `Break ${fmtCountdown(breakRemaining)}`
      : phase === "ready" ? "Break over · ProjectsTracker"
      : "ProjectsTracker";
  }, [demo, phase, runningProject, focusRemaining, breakRemaining]);

  const selectDay = (d) => {
    setSelected(d);
    if (!isSameMonth(d, cursor)) setCursor(d);
  };

  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  const todaySecs = daySeconds(byDay, today);
  const weekSecs = Array.from({ length: 7 }, (_, i) =>
    daySeconds(byDay, new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i))
  ).reduce((a, b) => a + b, 0);

  /** Edit a project. Finishing it ends its timer, here and (via the server) in the data. */
  const saveProject = async (id, data) => {
    if (statusesById.get(data.status_id)?.is_done && t.running?.project_id === id) await t.stopTimer();
    return t.updateProject(id, data);
  };

  /** A drag on the board, or "Move to" in a card's menu. */
  const moveProject = async (id, statusId) => {
    if (statusesById.get(statusId)?.is_done && t.running?.project_id === id) await t.stopTimer();
    return t.moveProject(id, statusId);
  };

  const openAddTime = (projectId, date) =>
    projects.some(isOpen)
      ? setSessionModal({ projectId, date: date ?? today })
      : setProjectModal({});

  const cardProps = (p) => {
    const isRunning = t.running?.project_id === p.id;
    return {
      isRunning,
      elapsed,
      totalSeconds: p.total_seconds + (isRunning ? elapsed : 0),
      todaySeconds: daySeconds(byDay, today, p.id),
      lastSeven: Array.from({ length: 7 }, (_, i) => {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + i);
        return { label: format(d, "EEE d"), secs: daySeconds(byDay, d, p.id) };
      }),
      openTodos: openTodoCounts.get(p.id) ?? 0,
      onOpen: () => setDetailId(p.id),
      onToggleTimer: () => (isRunning ? t.stopTimer() : t.startTimer(p.id)),
      onAddTime: () => openAddTime(p.id),
      onEdit: () => setProjectModal({ project: p }),
      onDelete: () => setConfirm({ kind: "project", item: p }),
    };
  };

  const detailProject = detailId ? projectsById.get(detailId) : null;
  const pickableProjects = projects.filter(
    (p) => isOpen(p) || p.id === sessionModal?.session?.project_id || p.id === sessionModal?.projectId
  );

  if (t.status === "error") return <ServerDown onRetry={t.reload} />;

  const tabs = [
    { id: "projects", label: "Projects", icon: Columns3 },
    { id: "calendar", label: "Calendar", icon: CalendarDays },
    { id: "stats", label: "Stats", icon: ChartColumn },
  ];

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <Header
          runningProject={runningProject}
          runningSession={t.running}
          onSaveNote={(note) => t.updateSession(t.running.id, { note })}
          pomodoro={pomodoro}
          breakProject={breakProject}
          onStop={t.stopTimer}
          onNewProject={() => setProjectModal({})}
          theme={theme}
          onToggleTheme={toggleTheme}
          onSignOut={onSignOut}
          signOutLabel={signOutLabel}
          onInbox={demo ? undefined : () => setInboxOpen(true)}
          inboxUnread={inbox.unread}
        />

        <TabBar
          tabs={tabs}
          value={tab}
          onChange={setTab}
          label="Sections"
          className="mx-auto w-full max-w-7xl shrink-0 px-2 sm:px-5"
          right={
            <>
              <span className="figures hidden whitespace-nowrap text-xs text-muted sm:inline">
                Today <span className="font-semibold text-text">{fmtHM(todaySecs)}</span>
                <span className="mx-2 text-faint">·</span>
                Week <span className="font-semibold text-text">{fmtHM(weekSecs)}</span>
              </span>
              {tab === "projects" && t.status === "ready" && (
                <button
                  onClick={() => setStatusesOpen(true)}
                  className="inline-flex h-8 items-center gap-1.5 px-2 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-text"
                >
                  <SlidersHorizontal size={14} /> <span className="max-sm:sr-only">Statuses</span>
                </button>
              )}
            </>
          }
        />

        <main
          role="tabpanel"
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
          className="mx-auto min-h-0 w-full max-w-7xl flex-1 overflow-y-auto px-4 py-3 sm:px-6"
        >
          {t.status === "loading" ? (
            <Skeleton />
          ) : tab === "projects" ? (
            projects.length === 0 ? (
              <EmptyBoard onCreate={() => setProjectModal({})} />
            ) : (
              <ProjectBoard
                projects={projects}
                statuses={t.statuses}
                cardProps={cardProps}
                onMove={moveProject}
                onCreate={(statusId) => setProjectModal({ statusId })}
              />
            )
          ) : tab === "calendar" ? (
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,32rem)_minmax(0,1fr)] lg:gap-10">
              <MonthCalendar
                cursor={cursor}
                onCursor={setCursor}
                selected={selected}
                onSelect={selectDay}
                byDay={byDay}
                projectsById={projectsById}
                today={today}
              />
              <DayPanel
                date={selected}
                sessions={t.sessions}
                byDay={byDay}
                projectsById={projectsById}
                now={now}
                onAdd={() => openAddTime(undefined, selected)}
                onEdit={(s) => setSessionModal({ session: s })}
                onDelete={(s) => setConfirm({ kind: "session", item: s })}
                onStop={t.stopTimer}
              />
            </div>
          ) : (
            <>
              <StatsStrip
                byDay={byDay}
                today={today}
                weekStart={weekStart}
                streakDays={streak(byDay, today)}
                openProjects={openProjects}
                neglected={neglected}
                onOpenProject={setDetailId}
                projectsById={projectsById}
                runningProjectId={t.running?.project_id}
              />
              <Heatmap
                byDay={byDay}
                projects={projects}
                projectsById={projectsById}
                today={today}
                selected={selected}
                onSelect={(d) => {
                  selectDay(d);
                  setTab("calendar");
                }}
              />
            </>
          )}
        </main>
      </div>

      <PomodoroDrawer
        open={pomodoroOpen}
        onOpenChange={setPomodoroOpen}
        settings={pomodoro.settings}
        onChange={pomodoro.setSettings}
        onReset={pomodoro.resetSettings}
      />

      <Toast notice={t.notice} onDismiss={t.dismissNotice} />

      {inboxOpen && <InterestInbox inbox={inbox} onClose={() => setInboxOpen(false)} />}

      {statusesOpen && (
        <StatusModal projects={projects} statuses={t.statuses} ops={t.statusOps} onClose={() => setStatusesOpen(false)} />
      )}

      {detailProject && (
        <ProjectDetail
          project={detailProject}
          status={statusesById.get(detailProject.status_id)}
          todos={t.todos.filter((x) => x.project_id === detailProject.id)}
          sessions={t.sessions
            .filter((x) => x.project_id === detailProject.id)
            .sort((a, b) => b.start - a.start)}
          isRunning={t.running?.project_id === detailProject.id}
          elapsed={elapsed}
          totalSeconds={detailProject.total_seconds + (t.running?.project_id === detailProject.id ? elapsed : 0)}
          now={now}
          onClose={() => setDetailId(null)}
          onEdit={() => {
            setDetailId(null);
            setProjectModal({ project: detailProject });
          }}
          onToggleTimer={() =>
            t.running?.project_id === detailProject.id ? t.stopTimer() : t.startTimer(detailProject.id)
          }
          onSaveNotes={(notes) => saveProject(detailProject.id, { notes })}
          onSaveSessionNote={(id, note) => t.updateSession(id, { note })}
          todoOps={t.todoOps}
        />
      )}

      {projectModal && (
        <ProjectModal
          project={projectModal.project}
          statuses={t.statuses}
          defaultStatusId={projectModal.statusId}
          usedColors={projects.map((p) => p.color)}
          onClose={() => setProjectModal(null)}
          onSave={(data) => (projectModal.project ? saveProject(projectModal.project.id, data) : t.createProject(data))}
        />
      )}

      {sessionModal && (
        <SessionModal
          session={sessionModal.session}
          projectId={sessionModal.projectId}
          date={sessionModal.date ?? today}
          projects={pickableProjects}
          onClose={() => setSessionModal(null)}
          onSave={(data) =>
            sessionModal.session ? t.updateSession(sessionModal.session.id, data) : t.addSession(data)
          }
          onDelete={(s) => {
            setSessionModal(null);
            setConfirm({ kind: "session", item: s });
          }}
        />
      )}

      {confirm?.kind === "project" && (
        <ConfirmDialog
          title="Delete project?"
          project={confirm.item}
          primary={confirm.item.name}
          secondary={`−${fmtHM(
            confirm.item.total_seconds + (t.running?.project_id === confirm.item.id ? elapsed : 0)
          )} logged`}
          note="The project and all its sessions will be removed. This can't be undone."
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            t.deleteProject(confirm.item.id);
            setConfirm(null);
          }}
        />
      )}

      {confirm?.kind === "session" && projectsById.has(confirm.item.project_id) && (
        <ConfirmDialog
          title="Delete session?"
          project={projectsById.get(confirm.item.project_id)}
          primary={`${format(confirm.item.start, "MMM d")}, ${fmtTime(confirm.item.start)} to ${fmtTime(confirm.item.end)}`}
          secondary={`−${fmtHM(sessionSeconds(confirm.item, now))}`}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            t.deleteSession(confirm.item.id);
            setConfirm(null);
          }}
        />
      )}
    </>
  );
}

function Skeleton() {
  return (
    <div className="grid animate-pulse gap-3 sm:grid-cols-3" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <div key={i} className="border border-line bg-surface-2/40 p-3">
          <div className="h-5 w-24 bg-surface-2" />
          <div className="mt-3 h-24 bg-surface-2" />
          <div className="mt-2 h-24 bg-surface-2" />
        </div>
      ))}
    </div>
  );
}

/** Nothing yet: the one thing to do is make the first project. */
function EmptyBoard({ onCreate }) {
  return (
    <div className="grid h-full min-h-[16rem] place-items-center border border-dashed border-line-strong p-6 text-center">
      <div>
        <p className="font-serif text-lg font-semibold">No projects yet</p>
        <p className="mt-1 text-[13px] text-muted">Each project becomes a card you can start a timer on.</p>
        <Button variant="primary" onClick={onCreate} className="mt-4">
          Create your first project
        </Button>
      </div>
    </div>
  );
}

function ServerDown({ onRetry }) {
  return (
    <div className="grid min-h-[100dvh] place-items-center p-4">
      <div className="w-full max-w-md border border-line-strong bg-surface p-7">
        <ServerOff size={26} className="text-danger" />
        <h1 className="mt-4 font-serif text-2xl font-semibold">Can't reach the API</h1>
        <p className="mt-2 text-[13px] text-muted">Start the backend, then retry:</p>
        <code className="mt-3 block border border-line bg-surface-2 px-3 py-2.5 font-mono text-xs">
          uvicorn backend.main:app --reload --port 8001
        </code>
        <Button variant="primary" onClick={onRetry} className="mt-6">
          <RotateCw size={15} /> Retry
        </Button>
      </div>
    </div>
  );
}
