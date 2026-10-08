import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { CalendarDays, ChartColumn, Columns3, ListChecks, ListTodo, RotateCw, ServerOff, SlidersHorizontal } from "lucide-react";
import { useTracker } from "./hooks/useTracker";
import { useTheme } from "./hooks/useTheme";
import { useInbox } from "./hooks/useInbox";
import { useNow } from "./hooks/useNow";
import { usePomodoro } from "./hooks/usePomodoro";
import { useMiniPlayer } from "./hooks/useMiniPlayer";
import {
  aggregateByDay, dayKey, daySeconds, feedQueue, fmtClock, fmtCountdown, fmtHM, fmtTime, completedPomodoros, mostNeglected, pomodorosOnDay, projectPomodoroCount, sessionSeconds, streak, withLive,
} from "./lib/time";
import Header from "./components/Header";
import PomodoroDrawer from "./components/PomodoroDrawer";
import PomodoroScreen from "./components/PomodoroScreen";
import MiniPlayer from "./components/MiniPlayer";
import StatsStrip from "./components/StatsStrip";
import ProjectBoard from "./components/ProjectBoard";
import FeedView from "./components/FeedView";
import TabBar from "./components/TabBar";
import BottomTabBar from "./components/BottomTabBar";
import MonthCalendar from "./components/MonthCalendar";
import DayPanel from "./components/DayPanel";
import TimeGrid from "./components/TimeGrid";
import Heatmap from "./components/Heatmap";
import ProjectModal from "./components/ProjectModal";
import StatusModal from "./components/StatusModal";
import ProjectDetail from "./components/ProjectDetail";
import ProjectPeek from "./components/ProjectPeek";
import ProjectSearch from "./components/ProjectSearch";
import TasksView, { TaskDetail } from "./components/TasksView";
import OpenItemsBar from "./components/OpenItemsBar";
import WorkingMenu from "./components/WorkingMenu";
import SessionModal from "./components/SessionModal";
import ConfirmDialog from "./components/ConfirmDialog";
import InterestInbox from "./components/InterestInbox";
import Toast from "./components/Toast";
import { Button } from "./components/Modal";
import { TASK_ICON, TASK_INK, inkFor } from "./lib/palette";
import { taskKey } from "./api";

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
  // The to-do the timer was last on, if it was timing one: a pomodoro that picks the project back up after
  // a break picks that to-do up with it
  const lastTodo = useRef(null);
  if (t.running) lastTodo.current = t.running.todo_id ? { projectId: t.running.project_id, todoId: t.running.todo_id } : null;
  const { startTimer: startTimerOn } = t;
  const resumeTimer = useCallback(
    (id) => startTimerOn(id, lastTodo.current?.projectId === id ? lastTodo.current.todoId : null),
    [startTimerOn]
  );
  const pomodoro = usePomodoro({
    running: t.running, startTimer: resumeTimer, stopTimer: t.stopTimer, onFocusDone: t.addPomodoro, scope: demo ? "demo" : "app",
  });
  const [pomodoroOpen, setPomodoroOpen] = useState(false);
  const [screenOpen, setScreenOpen] = useState(false); // the pomodoro full screen
  const mini = useMiniPlayer(); // the mini clock: a floating window, or a widget over the page

  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => new Date());
  const [tab, setTab] = useState("projects"); // projects | feed | calendar | stats
  const [calView, setCalView] = useCalendarView(); // month | week | day
  const [statusesOpen, setStatusesOpen] = useState(false);
  // The side peek: the project last clicked (its notes, to-dos and sessions), and whether the panel is out
  const [peekId, setPeekId] = useState(null);
  const [peekOpen, setPeekOpen] = useState(false);
  const peek = (id) => {
    setPeekId(id);
    setPeekOpen(true);
  };
  const [searchOpen, setSearchOpen] = useState(false);
  const [projectModal, setProjectModal] = useState(null); // { project? }
  // { session?, openItem?, projectId?, date?, span?, startOpen? }: a session to log or edit, or an open item
  const [sessionModal, setSessionModal] = useState(null);
  const [confirm, setConfirm] = useState(null); // { kind: "session", item }; projects are deleted on the board's trash can

  // Projects saved with a v1 neon color are shown in the nearest ledger ink.
  // `projects` is every project, archived or not: the calendar, day panel and stats still need
  // the archived ones to name and add up the time logged on them. The board, the Feed and the
  // open stats work from `liveProjects`; the archive drawer from `archivedProjects`.
  const projects = useMemo(() => t.projects.map((p) => ({ ...p, color: inkFor(p.color) })), [t.projects]);
  // Tasks: to-dos with no project. Time on one is filed under "task:" and its id (see api.js), and the
  // task stands in for a project wherever time is named, colored and added up: `projectsById` holds both.
  const tasks = useMemo(() => t.todos.filter((x) => !x.project_id), [t.todos]);
  const taskSubjects = useMemo(
    () =>
      tasks
        .filter((x) => !x.parent_id)
        .map((x) => ({
          id: taskKey(x.id), kind: "task", todoId: x.id, name: x.text, color: TASK_INK, icon: TASK_ICON,
          total_seconds: x.total_seconds ?? 0, done: x.done, created_at: x.created_at, archived_at: null, status_id: null,
        })),
    [tasks]
  );
  const openTaskSubjects = useMemo(() => taskSubjects.filter((x) => !x.done), [taskSubjects]);
  const projectsById = useMemo(() => new Map([...projects, ...taskSubjects].map((p) => [p.id, p])), [projects, taskSubjects]);
  const liveProjects = useMemo(() => projects.filter((p) => !p.archived_at), [projects]);
  const archivedProjects = useMemo(
    () => projects.filter((p) => p.archived_at).sort((a, b) => new Date(b.archived_at) - new Date(a.archived_at)),
    [projects]
  );
  const statusesById = useMemo(() => new Map(t.statuses.map((s) => [s.id, s])), [t.statuses]);
  const isOpen = (p) => !statusesById.get(p.status_id)?.is_done;

  const openProjects = useMemo(() => liveProjects.filter(isOpen), [liveProjects, statusesById]);
  // What a timer can be started on from the pomodoro screen, the mini clock and the Add time window
  const pickSubjects = useMemo(() => [...openProjects, ...openTaskSubjects], [openProjects, openTaskSubjects]);
  // Only re-evaluated once per day (and when sessions change): "days idle" doesn't move by the second
  const neglected = useMemo(
    () => mostNeglected(openProjects, t.sessions, new Date(`${todayKey}T23:59:59`), t.todos),
    [openProjects, t.sessions, t.todos, todayKey]
  );
  const runningId = t.running?.project_id;
  // The Feed's queue; like `neglected`, it only needs to be re-ranked when sessions or the day change
  const queue = useMemo(
    () => feedQueue(openProjects, t.sessions, new Date(`${todayKey}T23:59:59`), runningId, t.todos),
    [openProjects, t.sessions, t.todos, todayKey, runningId]
  );
  const openTodosByProject = useMemo(() => {
    const byProject = new Map();
    for (const todo of t.todos) {
      if (todo.done) continue;
      if (!byProject.has(todo.project_id)) byProject.set(todo.project_id, []);
      byProject.get(todo.project_id).push(todo);
    }
    return byProject;
  }, [t.todos]);

  const todosById = useMemo(() => new Map(t.todos.map((x) => [x.id, x])), [t.todos]);

  const baseByDay = useMemo(() => aggregateByDay(t.sessions), [t.sessions]);
  // The running timer and every open item count as they go
  const byDay = useMemo(
    () => t.openItems.reduce((map, item) => withLive(map, item, now), withLive(baseByDay, t.running, now)),
    [baseByDay, t.running, t.openItems, now]
  );
  /** Seconds open items on a project (or task) have run so far. */
  const openSeconds = (subjectId) =>
    t.openItems.reduce((sum, x) => (x.project_id === subjectId ? sum + Math.max(0, (now - x.start) / 1000) : sum), 0);
  // Open items shown on the calendar like sessions still going, which open the item when clicked
  const calendarSessions = useMemo(
    () => [
      ...t.sessions,
      ...t.openItems.map((x) => ({ id: `open-${x.id}`, project_id: x.project_id, start: x.start, end: null, note: x.note, openItem: x })),
    ],
    [t.sessions, t.openItems]
  );
  const elapsed = t.running ? sessionSeconds(t.running, now) : 0;
  // What the running timer's clock shows: a project picked back up after a pomodoro break carries
  // on from the time it had. That earlier time is already logged, so totals use `elapsed` alone.
  const clock = elapsed + pomodoro.carry;
  const heldProject = pomodoro.heldProjectId ? projectsById.get(pomodoro.heldProjectId) ?? null : null;
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

  // The countdown in the browser tab, so it's visible from anywhere. The demo is
  // embedded in a page of its own, so it leaves the tab title alone.
  const { phase, focusRemaining, breakRemaining } = pomodoro;
  useEffect(() => {
    if (demo) return;
    const on = runningProject ? ` · ${runningProject.name}` : "";
    document.title =
      phase === "focus" ? `${fmtCountdown(focusRemaining)} · Focus${on}`
      : phase === "focusPaused" ? `Paused ${fmtCountdown(focusRemaining)}${on}`
      : phase === "break" ? `Break ${fmtCountdown(breakRemaining)}`
      : phase === "breakPaused" ? `Break paused ${fmtCountdown(breakRemaining)}`
      : phase === "breakWait" ? "Start your break · ProjectsTracker"
      : phase === "ready" ? "Break over · ProjectsTracker"
      : runningProject ? `${fmtClock(clock)}${on}`
      : "ProjectsTracker";
  }, [demo, phase, runningProject, clock, focusRemaining, breakRemaining]);

  // Ctrl+F (⌘F on a Mac) opens the project search instead of the browser's find. The demo sits on a
  // public page, where taking that shortcut over would be rude, so it only has the button. With another
  // window open on top of the board it is left to the browser too.
  useEffect(() => {
    if (demo) return;
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "f") return;
      if (!searchOpen && document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      if (searchOpen) document.getElementById("project-search")?.select();
      else setSearchOpen(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [demo, searchOpen]);

  // The owner's phone layout has a tab bar along the bottom: let fixed layers (peek, toast) know to clear it
  useEffect(() => {
    if (demo) return;
    document.documentElement.dataset.bottomBar = "";
    return () => {
      delete document.documentElement.dataset.bottomBar;
    };
  }, [demo]);

  /** The Tasks tab, picked from any of the searches: whatever is over the page (the search, the pomodoro's
   *  full screen) goes so it can be seen. From the floating mini clock, the app's own window is brought up. */
  const showTasks = useCallback(() => {
    setSearchOpen(false);
    setScreenOpen(false);
    setTab("tasks");
    window.focus();
  }, []);

  const selectDay = (d) => {
    setSelected(d);
    if (!isSameMonth(d, cursor)) setCursor(d);
  };

  const pomodorosToday = completedPomodoros(pomodorosOnDay(t.pomodoros, today)).length;

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

  /** A card dragged to another column on the board. */
  const moveProject = async (id, statusId, index) => {
    if (statusesById.get(statusId)?.is_done && t.running?.project_id === id) await t.stopTimer();
    return t.moveProject(id, statusId, index);
  };

  /** A card dropped on the archive drawer. Archiving ends its timer, here and (via the server) in the data. */
  const archiveProject = async (id) => {
    if (t.running?.project_id === id) await t.stopTimer();
    return t.archiveProject(id);
  };

  /** Start a project's timer by hand; a pomodoro that isn't going starts with it. */
  const startProject = (id) => {
    const started = t.startTimer(id);
    pomodoro.followTimer();
    return started;
  };

  /** A project found from the mini clock: with no pomodoro going it starts the way a card's timer does (a
   *  focus with it); otherwise it takes over the timer, as picking one in the full screen does. */
  const pickFromMini = (id) => {
    if (t.running?.project_id === id) return;
    if (!t.running && (pomodoro.phase === "idle" || pomodoro.phase === "ready")) startProject(id);
    else t.startTimer(id);
  };

  /** Time one of a project's to-dos: the project's timer, on that to-do (which is marked as being worked on). */
  const startTodo = (todo) => {
    const started = t.startTimer(todo.project_id, todo.id);
    pomodoro.followTimer();
    if (!todo.working_since) t.todoOps.update(todo.id, { working: true });
    return started;
  };

  /** Stop a focus, and the project timer that goes with it. Stopping a break leaves a running timer alone. */
  const stopFocus = () => {
    pomodoro.dismiss();
    if (t.running) t.stopTimer();
  };

  const openAddTime = (projectId, date, span) =>
    pickSubjects.length > 0 ? setSessionModal({ projectId, date: date ?? today, span }) : setProjectModal({});
  /** A session or an open item from the calendar or the day's list: an open item opens as one. */
  const editEntry = (s) => setSessionModal(s.openItem ? { openItem: s.openItem } : { session: s });
  const stopEntry = (s) => (s?.openItem ? t.openOps.close(s.openItem.id) : t.stopTimer());

  const cardProps = (p) => {
    const isRunning = t.running?.project_id === p.id;
    return {
      isRunning,
      elapsed: clock,
      totalSeconds: p.total_seconds + (isRunning ? elapsed : 0) + openSeconds(p.id),
      todaySeconds: daySeconds(byDay, today, p.id),
      lastSeven: Array.from({ length: 7 }, (_, i) => {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + i);
        return { label: format(d, "EEE d"), secs: daySeconds(byDay, d, p.id) };
      }),
      openTodos: openTodoCounts.get(p.id) ?? 0,
      onOpen: () => peek(p.id),
      onToggleTimer: () => (isRunning ? t.stopTimer() : startProject(p.id)),
      onAddTime: () => openAddTime(p.id),
      onEdit: () => setProjectModal({ project: p }),
    };
  };

  /** A project opened up (to-dos, notes, sessions): in the side peek, and in the pomodoro's full screen.
   *  A task opens as one too, with what a task has. */
  const projectDetail = (project) => {
    const isRunning = t.running?.project_id === project.id;
    if (project.kind === "task") {
      const task = todosById.get(project.todoId);
      if (!task) return null;
      return (
        <TaskDetail
          key={project.id}
          task={task}
          sessions={t.sessions.filter((x) => x.project_id === project.id).sort((a, b) => b.start - a.start)}
          totalSeconds={project.total_seconds + (isRunning ? elapsed : 0) + openSeconds(project.id)}
          isRunning={isRunning}
          elapsed={clock}
          now={now}
          todoOps={t.todoOps}
          onToggleTimer={() => (isRunning ? t.stopTimer() : startProject(project.id))}
          onLeaveOpen={() => setSessionModal({ projectId: project.id, startOpen: true })}
        />
      );
    }
    return (
      <ProjectDetail
        key={project.id}
        project={project}
        status={statusesById.get(project.status_id)}
        todos={t.todos.filter((x) => x.project_id === project.id)}
        sessions={t.sessions.filter((x) => x.project_id === project.id).sort((a, b) => b.start - a.start)}
        pomodoroCount={projectPomodoroCount(project.id, t.sessions, t.pomodoros, now)}
        isRunning={isRunning}
        elapsed={clock}
        totalSeconds={project.total_seconds + (isRunning ? elapsed : 0) + openSeconds(project.id)}
        now={now}
        archived={Boolean(project.archived_at)}
        onRestore={() => t.restoreProject(project.id)}
        onEdit={() => setProjectModal({ project })}
        onToggleTimer={() => (isRunning ? t.stopTimer() : startProject(project.id))}
        onSaveNotes={(notes) => saveProject(project.id, { notes })}
        onSaveSessionNote={(id, note) => t.updateSession(id, { note })}
        todoOps={t.todoOps}
        timedTodoId={isRunning ? t.running.todo_id ?? null : null}
        onTimeTodo={(todo) => (isRunning && t.running.todo_id === todo.id ? t.stopTimer() : startTodo(todo))}
      />
    );
  };

  const peekProject = peekId ? projectsById.get(peekId) ?? null : null;
  // Time can be logged on open projects that are on the board and on tasks still to do; a session
  // already logged on anything else can still be edited
  const editedSubject = sessionModal?.session?.project_id ?? sessionModal?.openItem?.project_id ?? sessionModal?.projectId;
  const pickableProjects =
    editedSubject && !pickSubjects.some((p) => p.id === editedSubject) && projectsById.has(editedSubject)
      ? [...pickSubjects, projectsById.get(editedSubject)]
      : pickSubjects;

  // How the find shortcut reads on this machine; the demo doesn't take the shortcut (see above)
  const searchHint = demo ? undefined : /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘F" : "Ctrl F";

  if (t.status === "error") return <ServerDown onRetry={t.reload} />;

  const tabs = [
    { id: "projects", label: "Projects", icon: Columns3 },
    { id: "tasks", label: "Tasks", icon: ListChecks },
    { id: "feed", label: "Feed", icon: ListTodo },
    { id: "calendar", label: "Calendar", icon: CalendarDays },
    { id: "stats", label: "Stats", icon: ChartColumn },
  ];

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <Header
          runningProject={runningProject}
          runningSession={t.running}
          elapsed={clock}
          heldProject={heldProject}
          heldSeconds={pomodoro.heldSeconds}
          onSaveNote={(note) => t.updateSession(t.running.id, { note })}
          pomodoro={pomodoro}
          pomodorosToday={pomodorosToday}
          onStop={t.stopTimer}
          onStopFocus={stopFocus}
          onExpand={() => setScreenOpen(true)}
          onMini={mini.open ? mini.close : mini.show}
          miniOpen={mini.open}
          onNewProject={() => setProjectModal({})}
          onSearch={() => setSearchOpen(true)}
          searchHint={searchHint}
          theme={theme}
          onToggleTheme={toggleTheme}
          onSignOut={onSignOut}
          signOutLabel={signOutLabel}
          onInbox={demo ? undefined : () => setInboxOpen(true)}
          inboxUnread={inbox.unread}
          onStatuses={!demo && tab === "projects" && t.status === "ready" ? () => setStatusesOpen(true) : undefined}
          workingMenu={
            t.status === "ready" && (
              <WorkingMenu todos={t.todos} projectsById={projectsById} todoOps={t.todoOps} now={now} onOpen={peek} />
            )
          }
        />

        <TabBar
          tabs={tabs}
          value={tab}
          onChange={setTab}
          label="Sections"
          className={`mx-auto w-full max-w-7xl shrink-0 px-2 sm:px-5 ${demo ? "" : "max-sm:hidden"}`}
          right={
            <>
              <span className="figures hidden whitespace-nowrap text-xs text-muted md:inline">
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

        <OpenItemsBar
          items={t.openItems}
          subjectsById={projectsById}
          now={now}
          onOpen={(item) => setSessionModal({ openItem: item })}
          onClose={(item) => t.openOps.close(item.id)}
          className="mx-auto w-full max-w-7xl shrink-0 border-b border-line px-4 sm:px-6"
        />

        <main
          role="tabpanel"
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
          className="relative mx-auto min-h-0 w-full max-w-7xl flex-1 overflow-y-auto px-4 py-3 sm:px-6"
        >
          {t.status === "loading" ? (
            <Skeleton />
          ) : tab === "projects" ? (
            projects.length === 0 ? (
              <EmptyBoard onCreate={() => setProjectModal({})} />
            ) : (
              <ProjectBoard
                projects={liveProjects}
                archived={archivedProjects}
                statuses={t.statuses}
                cardProps={cardProps}
                onMove={moveProject}
                onCreate={(statusId) => setProjectModal({ statusId })}
                onDelete={t.deleteProject}
                onArchive={archiveProject}
                onRestore={t.restoreProject}
                onOpenArchived={peek}
              />
            )
          ) : tab === "tasks" ? (
            <TasksView
              tasks={tasks}
              todoOps={t.todoOps}
              runningId={runningId}
              clock={clock}
              openItems={t.openItems}
              now={now}
              secondsFor={(task) =>
                (task.total_seconds ?? 0) + (runningId === taskKey(task.id) ? elapsed : 0) + openSeconds(taskKey(task.id))
              }
              onStart={startProject}
              onStop={t.stopTimer}
              onLeaveOpen={(key) => setSessionModal({ projectId: key, startOpen: true })}
              onLogTime={(key) => setSessionModal({ projectId: key, date: today })}
              onOpenItem={(item) => setSessionModal({ openItem: item })}
            />
          ) : tab === "feed" ? (
            projects.length === 0 ? (
              <EmptyBoard onCreate={() => setProjectModal({})} />
            ) : (
              <FeedView
                queue={queue}
                todosByProject={openTodosByProject}
                todosById={todosById}
                todoOps={t.todoOps}
                statusesById={statusesById}
                runningId={runningId}
                elapsed={clock}
                onOpen={peek}
                onStart={startProject}
                onStop={t.stopTimer}
                onSkip={t.skipProject}
              />
            )
          ) : tab === "calendar" ? (
            <div className="flex h-full flex-col">
              {calView === "month" && <CalendarViews value={calView} onChange={setCalView} />}
              {/* Week and day fill what is left of the window, so the page itself never scrolls: the hours do */}
              <div
                className={`grid gap-6 lg:gap-10 ${
                  calView === "month" ? "items-start lg:grid-cols-[minmax(0,32rem)_minmax(0,1fr)]"
                  : calView === "day" ? "min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:grid-rows-[minmax(0,1fr)]"
                  : "min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]"
                }`}
              >
                {calView === "month" ? (
                  <MonthCalendar
                    cursor={cursor}
                    onCursor={setCursor}
                    selected={selected}
                    onSelect={selectDay}
                    byDay={byDay}
                    projectsById={projectsById}
                    today={today}
                  />
                ) : (
                  <TimeGrid
                    mode={calView}
                    date={selected}
                    today={today}
                    now={now}
                    sessions={calendarSessions}
                    pomodoros={t.pomodoros}
                    todos={t.todos}
                    projectsById={projectsById}
                    onNavigate={selectDay}
                    onOpenDay={(d) => {
                      selectDay(d);
                      setCalView("day");
                    }}
                    onEditSession={editEntry}
                    onAddSpan={(span) => openAddTime(undefined, span.start, span)}
                    onMoveSession={(s, span) => t.updateSession(s.id, span)}
                    viewSwitch={<CalendarViews value={calView} onChange={setCalView} className="max-sm:basis-full" />}
                  />
                )}
                {calView !== "week" && (
                  <div className={calView === "day" ? "min-h-0 lg:overflow-y-auto" : undefined}>
                    <DayPanel
                      date={selected}
                      sessions={calendarSessions}
                      pomodoros={t.pomodoros}
                      todos={t.todos}
                      byDay={byDay}
                      projectsById={projectsById}
                      now={now}
                      onAdd={() => openAddTime(undefined, selected)}
                      onEdit={editEntry}
                      onDelete={(s) => setConfirm({ kind: "session", item: s })}
                      onStop={stopEntry}
                    />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <StatsStrip
                byDay={byDay}
                pomodoros={t.pomodoros}
                today={today}
                weekStart={weekStart}
                streakDays={streak(byDay, today)}
                openProjects={openProjects}
                neglected={neglected}
                onOpenProject={peek}
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

        {!demo && <BottomTabBar tabs={tabs} value={tab} onChange={setTab} label="Sections" />}
      </div>

      {screenOpen && (
        <PomodoroScreen
          pomodoro={pomodoro}
          pomodorosToday={pomodorosToday}
          projects={pickSubjects}
          runningProject={runningProject}
          runningSession={t.running}
          clock={clock}
          heldProject={heldProject}
          heldSeconds={pomodoro.heldSeconds}
          onStartTimer={t.startTimer}
          onStopTimer={t.stopTimer}
          onStopFocus={stopFocus}
          onSaveNote={(note) => t.updateSession(t.running.id, { note })}
          settingsOpen={pomodoroOpen}
          onClose={() => setScreenOpen(false)}
          renderDetail={projectDetail}
          onMiniPlayer={mini.open ? mini.close : mini.show}
          statusesById={statusesById}
          searchHint={searchHint}
          onTasks={showTasks}
        />
      )}

      {mini.open && (
        <MiniPlayer
          pomodoro={pomodoro}
          pip={mini.pip}
          hidden={screenOpen}
          runningProject={runningProject}
          clock={clock}
          heldProject={heldProject}
          heldSeconds={pomodoro.heldSeconds}
          todos={t.todos}
          todoOps={t.todoOps}
          timedTodoId={t.running?.todo_id ?? null}
          projects={pickSubjects}
          onPickProject={pickFromMini}
          onTasks={showTasks}
          onStopFocus={stopFocus}
          onClose={mini.close}
        />
      )}

      <PomodoroDrawer
        open={pomodoroOpen}
        onOpenChange={setPomodoroOpen}
        anchor={screenOpen ? "screen" : "header"}
        settings={pomodoro.settings}
        onChange={pomodoro.setSettings}
        onReset={pomodoro.resetSettings}
      />

      <Toast notice={t.notice} onDismiss={t.dismissNotice} />

      {inboxOpen && <InterestInbox inbox={inbox} onClose={() => setInboxOpen(false)} />}

      {statusesOpen && (
        // All projects, archived too: an archived project still holds on to its status
        <StatusModal projects={projects} statuses={t.statuses} ops={t.statusOps} onClose={() => setStatusesOpen(false)} />
      )}

      {searchOpen && (
        <ProjectSearch
          projects={[...projects, ...openTaskSubjects]}
          statusesById={statusesById}
          onTasks={showTasks}
          onClose={() => setSearchOpen(false)}
          onPick={(id) => {
            setSearchOpen(false);
            peek(id);
          }}
        />
      )}

      <ProjectPeek open={peekOpen} onOpenChange={setPeekOpen} project={peekProject} escPaused={pomodoroOpen}>
        {peekProject && projectDetail(peekProject)}
      </ProjectPeek>

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
          openItem={sessionModal.openItem}
          projectId={sessionModal.projectId}
          date={sessionModal.date ?? today}
          span={sessionModal.span}
          startOpen={sessionModal.startOpen}
          projects={pickableProjects}
          onClose={() => setSessionModal(null)}
          onSave={(data) =>
            sessionModal.session ? t.updateSession(sessionModal.session.id, data) : t.addSession(data)
          }
          onSaveOpen={(item, data) => (item ? t.openOps.update(item.id, data) : t.openOps.start(data))}
          onCloseOpen={async (item, { end, ...data }) => (await t.openOps.update(item.id, data)) && t.openOps.close(item.id, end)}
          onDelete={(s) => {
            setSessionModal(null);
            // An open item has nothing logged yet: it is just let go
            if (sessionModal.openItem) t.openOps.discard(s.id);
            else setConfirm({ kind: "session", item: s });
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

const CAL_VIEW_KEY = "pt-cal-view";
const CAL_VIEWS = [
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
  { id: "day", label: "Day" },
];

/** Which calendar is up: the month of ink washes, or a week or day laid out hour by hour. Remembered in this browser. */
function useCalendarView() {
  const [view, setView] = useState(() => {
    try {
      const saved = localStorage.getItem(CAL_VIEW_KEY);
      if (CAL_VIEWS.some((v) => v.id === saved)) return saved;
    } catch {
      // storage blocked: it just starts on the month
    }
    return "month";
  });
  const set = (next) => {
    setView(next);
    try {
      localStorage.setItem(CAL_VIEW_KEY, next);
    } catch {
      // storage blocked: it just won't survive a reload
    }
  };
  return [view, set];
}

function CalendarViews({ value, onChange, className = "mb-4" }) {
  return (
    <div role="radiogroup" aria-label="Calendar view" className={`inline-flex border border-line-strong ${className}`}>
      {CAL_VIEWS.map((v) => (
        <button
          key={v.id}
          role="radio"
          aria-checked={v.id === value}
          onClick={() => onChange(v.id)}
          className={`h-8 border-l border-line-strong px-3.5 text-[13px] font-semibold transition-colors first:border-l-0 ${
            v.id === value ? "bg-text text-bg" : "text-muted hover:bg-surface-2 hover:text-text"
          }`}
        >
          {v.label}
        </button>
      ))}
    </div>
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
