import { useEffect, useMemo, useState } from "react";
import { format, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { RotateCw, ServerOff } from "lucide-react";
import { useTracker } from "./hooks/useTracker";
import { useTheme } from "./hooks/useTheme";
import { useInbox } from "./hooks/useInbox";
import { useNow } from "./hooks/useNow";
import {
  aggregateByDay, dayKey, daySeconds, fmtClock, fmtHM, fmtTime, sessionSeconds, streak, withLive,
} from "./lib/time";
import Header from "./components/Header";
import StatsStrip from "./components/StatsStrip";
import ProjectGrid from "./components/ProjectGrid";
import MonthCalendar from "./components/MonthCalendar";
import DayPanel from "./components/DayPanel";
import Heatmap from "./components/Heatmap";
import ProjectModal from "./components/ProjectModal";
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

  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => new Date());
  const [projectModal, setProjectModal] = useState(null); // { project? }
  const [sessionModal, setSessionModal] = useState(null); // { session? , projectId?, date? }
  const [confirm, setConfirm] = useState(null); // { kind: "project" | "session", item }

  // Projects saved with a v1 neon color are shown in the nearest ledger ink.
  const projects = useMemo(() => t.projects.map((p) => ({ ...p, color: inkFor(p.color) })), [t.projects]);
  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const baseByDay = useMemo(() => aggregateByDay(t.sessions), [t.sessions]);
  const byDay = useMemo(() => withLive(baseByDay, t.running, now), [baseByDay, t.running, now]);
  const elapsed = t.running ? sessionSeconds(t.running, now) : 0;
  const runningProject = t.running ? projectsById.get(t.running.project_id) : null;

  // Pull older sessions when the calendar is paged back past the loaded year.
  const { ensureRange } = t;
  useEffect(() => {
    ensureRange(startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }));
  }, [cursor, ensureRange]);

  // Live timer in the browser tab, so it's visible from anywhere. The demo is
  // embedded in a page of its own, so it leaves the tab title alone.
  useEffect(() => {
    if (demo) return;
    document.title = runningProject ? `${fmtClock(elapsed)} · ${runningProject.name}` : "ProjectsTracker";
  }, [demo, runningProject, elapsed]);

  const selectDay = (d, scroll) => {
    setSelected(d);
    if (!isSameMonth(d, cursor)) setCursor(d);
    if (scroll) document.getElementById("calendar")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openAddTime = (projectId, date) =>
    projects.some((p) => p.status === "active")
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
      onToggleTimer: () => (isRunning ? t.stopTimer() : t.startTimer(p.id)),
      onAddTime: () => openAddTime(p.id),
      onEdit: () => setProjectModal({ project: p }),
      onToggleDone: () => {
        if (isRunning) t.stopTimer();
        t.updateProject(p.id, { status: p.status === "active" ? "done" : "active" });
      },
      onDelete: () => setConfirm({ kind: "project", item: p }),
    };
  };

  const pickableProjects = projects.filter(
    (p) => p.status === "active" || p.id === sessionModal?.session?.project_id || p.id === sessionModal?.projectId
  );

  if (t.status === "error") return <ServerDown onRetry={t.reload} />;

  return (
    <>
      <Header
        runningProject={runningProject}
        elapsed={elapsed}
        onStop={t.stopTimer}
        onNewProject={() => setProjectModal({})}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSignOut={onSignOut}
        signOutLabel={signOutLabel}
        onInbox={demo ? undefined : () => setInboxOpen(true)}
        inboxUnread={inbox.unread}
      />

      <main className="mx-auto max-w-7xl px-4 pb-10 sm:px-6">
        {t.status === "loading" ? (
          <Skeleton />
        ) : (
          <>
            <StatsStrip
              byDay={byDay}
              today={today}
              weekStart={startOfWeek(today, { weekStartsOn: 1 })}
              streakDays={streak(byDay, today)}
              projects={projects}
              projectsById={projectsById}
              runningProjectId={t.running?.project_id}
            />

            <div className="grid grid-cols-1 items-start border-b border-line lg:grid-cols-[minmax(0,1fr)_420px]">
              <ProjectGrid projects={projects} cardProps={cardProps} onCreate={() => setProjectModal({})} />

              <div id="calendar" className="scroll-mt-20 border-t border-line lg:self-stretch lg:border-t-0 lg:border-l lg:border-l-rule">
                <MonthCalendar
                  cursor={cursor}
                  onCursor={setCursor}
                  selected={selected}
                  onSelect={(d) => selectDay(d)}
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
            </div>

            <Heatmap
              byDay={byDay}
              projects={projects}
              projectsById={projectsById}
              today={today}
              selected={selected}
              onSelect={(d) => selectDay(d, true)}
            />
          </>
        )}
      </main>

      <Toast notice={t.notice} onDismiss={t.dismissNotice} />

      {inboxOpen && <InterestInbox inbox={inbox} onClose={() => setInboxOpen(false)} />}

      {projectModal && (
        <ProjectModal
          project={projectModal.project}
          usedColors={projects.map((p) => p.color)}
          onClose={() => setProjectModal(null)}
          onSave={(data) =>
            projectModal.project ? t.updateProject(projectModal.project.id, data) : t.createProject(data)
          }
        />
      )}

      {sessionModal && (
        <SessionModal
          session={sessionModal.session}
          projectId={sessionModal.projectId}
          date={sessionModal.date ?? today}
          projects={pickableProjects}
          now={now}
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
    <div className="animate-pulse" aria-label="Loading">
      <div className="grid grid-cols-2 border-b border-line lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2 py-4 pr-4">
            <div className="h-3 w-16 bg-surface-2" />
            <div className="h-7 w-24 bg-surface-2" />
          </div>
        ))}
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="py-5 lg:pr-6">
          <div className="mb-2 ml-11 h-5 w-24 bg-surface-2" />
          <div className="border-t border-rule">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="ledger-row">
                <span className="ledger-margin" />
                <span className="ledger-name">
                  <span className="h-3.5 w-40 bg-surface-2" />
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="py-5 lg:border-l lg:border-rule lg:pl-6">
          <div className="h-80 bg-surface-2" />
        </div>
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
