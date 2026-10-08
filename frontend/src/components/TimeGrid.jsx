import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, format } from "date-fns";
import { Check, ChevronLeft, ChevronRight, Hourglass } from "lucide-react";
import { iconFor, inkText, tint } from "../lib/palette";
import { dayKey, fmtHM, fmtTime, sessionSeconds } from "../lib/time";

const HOUR = 48; // px per hour
const DAY_PX = 24 * HOUR;
const SLOT = 15; // minutes everything on the grid snaps to
const CHIP = { day: 22, week: 14 }; // height of a ticked to-do's chip

// Hours down the side the way this browser writes times: "7 AM", or "07:00"
const HOUR12 = /h1[12]/.test(new Intl.DateTimeFormat([], { hour: "numeric" }).resolvedOptions().hourCycle ?? "");
const hourLabel = (h) => {
  const d = new Date(2000, 0, 1, h);
  return HOUR12 ? d.toLocaleTimeString([], { hour: "numeric" }) : format(d, "HH:mm");
};

const minutesInto = (date, dayStart) => (date - dayStart) / 60000;
const px = (minutes) => (minutes * HOUR) / 60;

/** Sessions clipped to one day, each given a lane so ones that overlap sit side by side:
 *  [{ session, top, height, lane, lanes }]. */
function layoutSessions(sessions, dayStart, dayEnd, now) {
  const items = sessions
    .filter((s) => s.start < dayEnd && (s.end ?? now) > dayStart)
    .map((s) => {
      const from = Math.max(0, minutesInto(s.start, dayStart));
      const to = Math.min(24 * 60, minutesInto(s.end ?? now, dayStart));
      return { session: s, from, to, top: px(from), height: Math.max(px(to - from), 3) };
    })
    .sort((a, b) => a.from - b.from || b.to - a.to);

  // Clusters of blocks that overlap; within one, each block takes the first lane that is free
  let cluster = [];
  let clusterEnd = -1;
  const close = () => {
    const lanes = Math.max(1, ...cluster.map((x) => x.lane + 1));
    for (const x of cluster) x.lanes = lanes;
    cluster = [];
  };
  for (const item of items) {
    if (item.from >= clusterEnd && cluster.length) close();
    const laneEnds = [];
    for (const x of cluster) laneEnds[x.lane] = Math.max(laneEnds[x.lane] ?? -1, x.to);
    let lane = laneEnds.findIndex((end) => end === undefined || end <= item.from);
    if (lane === -1) lane = laneEnds.length;
    item.lane = lane;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.to);
  }
  if (cluster.length) close();
  return items;
}

/** To-dos ticked off on one day, each placed at its time and nudged down so none covers another. */
function layoutTicked(todos, dayStart, dayEnd, chip) {
  let bottom = -Infinity;
  return todos
    .filter((x) => x.done && x.completed_at)
    .map((x) => ({ todo: x, at: new Date(x.completed_at) }))
    .filter((x) => x.at >= dayStart && x.at < dayEnd)
    .sort((a, b) => a.at - b.at)
    .map((x) => {
      const top = Math.min(Math.max(px(minutesInto(x.at, dayStart)) - chip / 2, bottom + 1), DAY_PX - chip);
      bottom = top + chip;
      return { ...x, top };
    });
}

const MINUTE = 60000;
const snap = (minutes) => Math.round(minutes / SLOT) * SLOT;
const atMinutes = (day, minutes) => new Date(day.getTime() + minutes * MINUTE);
const LONG_PRESS = 380; // ms a finger rests on a block (or an empty spot) before it picks it up

/**
 * The calendar as a day planner: one column per day (a week, or a single day) with the hours running down,
 * each session drawn as a block from its start to its end in its project's ink, the pomodoros as a strip
 * down the column's edge and the to-dos ticked off as chips at the moment they were done.
 *
 * Blocks move like Google Calendar's: drag one to another time (or, in a week, another day), drag its top
 * or bottom edge to change when it started or ended, all in steps of 15 minutes and never past now; the
 * session is saved with its new times when it is let go (`onMoveSession(session, { start, end })`). On a
 * touch screen a block is picked up by resting a finger on it. Clicking a block edits it; clicking an
 * empty spot logs time from there, and dragging down an empty stretch logs exactly that stretch
 * (`onAddSpan({ start, end? })`). A day's heading opens that day. The running session stays put.
 */
export default function TimeGrid({
  mode, date, today, now, sessions, pomodoros, todos, projectsById, onNavigate, onOpenDay, onEditSession, onAddSpan, onMoveSession, viewSwitch,
}) {
  const days = useMemo(() => {
    if (mode === "day") return [new Date(date.getFullYear(), date.getMonth(), date.getDate())];
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }, [mode, date]);
  const first = days[0];
  const last = days[days.length - 1];
  const step = mode === "day" ? 1 : 7;
  const todayKey = dayKey(today);
  const chip = CHIP[mode];

  // ── Dragging ──────────────────────────────────────────────────────────────
  const scroller = useRef(null);
  const gridRef = useRef(null);
  const gesture = useRef(null); // the pointer that is down: what it grabbed, where, and what it would make
  const suppressClick = useRef(false); // the click that ends a drag isn't a click
  const [drag, setDrag] = useState(null); // { id?, kind, start, end }: what is being dragged, as it would land
  const [pending, setPending] = useState(null); // { id, start, end }: let go, and being saved

  /** Which day column a point is over (the nearest one, off the sides) and how far down the day it is. */
  const pointAt = (x, y) => {
    const cols = [...gridRef.current.querySelectorAll("[data-day-col]")];
    let index = cols.findIndex((c) => x < c.getBoundingClientRect().right);
    if (index === -1) index = cols.length - 1;
    const top = cols[0].getBoundingClientRect().top;
    return { index, minutes: Math.min(Math.max(((y - top) / HOUR) * 60, 0), 24 * 60) };
  };

  /** Where the grabbed thing would land with the pointer at (x, y). Nothing ends after now. */
  const landing = (g, x, y) => {
    const p = pointAt(x, y);
    const nowMs = Math.floor(Date.now() / MINUTE) * MINUTE;
    if (g.kind === "create") {
      const a = Math.floor(g.at.minutes / SLOT) * SLOT;
      const b = snap(p.minutes);
      const lo = Math.min(a, b);
      const hi = Math.max(Math.max(a, b), lo + SLOT);
      const start = atMinutes(days[g.at.index], lo);
      const end = new Date(Math.min(atMinutes(days[g.at.index], hi).getTime(), nowMs));
      return end > start ? { start, end } : null;
    }
    const { start: s0, end: e0 } = g.session;
    if (g.kind === "move") {
      let start = atMinutes(addDays(s0, p.index - g.at.index), snap(p.minutes - g.at.minutes));
      let end = new Date(start.getTime() + (e0 - s0));
      if (end.getTime() > nowMs) {
        start = new Date(start.getTime() - (end.getTime() - nowMs));
        end = new Date(nowMs);
      }
      return { start, end };
    }
    // Resizing: the edge goes to the pointer, in the column the block was grabbed in
    const edge = atMinutes(days[g.dayIndex], snap(p.minutes));
    if (g.kind === "start") return { start: new Date(Math.min(edge.getTime(), e0.getTime() - SLOT * MINUTE)), end: e0 };
    const end = Math.min(Math.max(edge.getTime(), s0.getTime() + SLOT * MINUTE), nowMs);
    return end > s0.getTime() ? { start: s0, end: new Date(end) } : null;
  };

  const follow = (g, x, y) => {
    g.result = landing(g, x, y);
    setDrag(g.result ? { id: g.session?.id, kind: g.kind, ...g.result } : { id: g.session?.id, kind: g.kind, start: null, end: null });
  };

  const begin = (e, kind, dayIndex, session = null) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const g = {
      kind, session, dayIndex, pointerId: e.pointerId, x: e.clientX, y: e.clientY,
      at: pointAt(e.clientX, e.clientY), touch: e.pointerType !== "mouse", active: false, result: null, timer: null,
    };
    gesture.current = g;
    if (g.touch) {
      g.timer = setTimeout(() => {
        if (gesture.current !== g) return;
        g.active = true;
        navigator.vibrate?.(12);
        follow(g, g.x, g.y);
      }, LONG_PRESS);
    }
  };

  const endGesture = () => {
    const g = gesture.current;
    if (g) clearTimeout(g.timer);
    gesture.current = null;
    setDrag(null);
    return g;
  };

  // Listened for on the whole window, so a block can be dragged anywhere, even out of its column
  const latest = useRef({});
  latest.current = { follow, endGesture, onAddSpan, onMoveSession };
  useEffect(() => {
    const onMove = (e) => {
      const g = gesture.current;
      if (!g || e.pointerId !== g.pointerId) return;
      const dist = Math.hypot(e.clientX - g.x, e.clientY - g.y);
      if (!g.active) {
        // A finger that moves before the long press is scrolling; a mouse picks the block up after a few pixels
        if (g.touch) return dist > 8 && latest.current.endGesture();
        if (dist < 4) return;
        g.active = true;
      }
      latest.current.follow(g, e.clientX, e.clientY);
      // Near the top or bottom edge the hours scroll along
      const box = scroller.current?.getBoundingClientRect();
      if (box && e.clientY < box.top + 36) scroller.current.scrollTop -= 16;
      else if (box && e.clientY > box.bottom - 36) scroller.current.scrollTop += 16;
    };
    const onUp = (e) => {
      const g = gesture.current;
      if (!g || e.pointerId !== g.pointerId) return;
      latest.current.endGesture();
      if (!g.active) return; // a click: the block's (or the empty spot's) own handler has it
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      const r = g.result;
      if (!r) return;
      if (g.kind === "create") return latest.current.onAddSpan(r);
      if (r.start.getTime() === g.session.start.getTime() && r.end.getTime() === g.session.end.getTime()) return;
      const id = g.session.id;
      setPending({ id, ...r });
      Promise.resolve(latest.current.onMoveSession(g.session, r)).finally(() => setPending((p) => (p?.id === id ? null : p)));
    };
    const onCancel = (e) => {
      if (gesture.current && e.pointerId === gesture.current.pointerId) latest.current.endGesture();
    };
    // Once a finger has picked a block up, it moves the block instead of scrolling the page
    const onTouchMove = (e) => {
      if (gesture.current?.active) e.preventDefault();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  // The sessions as they are shown: the one being dragged where it would land, one just let go where it was put
  const known = sessions
    .filter((s) => projectsById.has(s.project_id))
    .map((s) =>
      drag?.id === s.id && drag.start ? { ...s, start: drag.start, end: drag.end }
      : pending?.id === s.id ? { ...s, start: pending.start, end: pending.end }
      : s
    );
  const knownTodos = todos.filter((x) => projectsById.has(x.project_id));
  const todoText = useMemo(() => new Map(todos.map((x) => [x.id, x.text])), [todos]);
  const draft = drag?.kind === "create" && drag.start ? drag : null;

  const columns = days.map((d) => {
    const dayStart = d;
    const dayEnd = addDays(d, 1);
    const blocks = layoutSessions(known, dayStart, dayEnd, now);
    return {
      day: d,
      key: dayKey(d),
      dayStart,
      blocks,
      total: blocks.reduce((sum, b) => sum + (b.to - b.from) * 60, 0),
      ticked: layoutTicked(knownTodos, dayStart, dayEnd, chip),
      pomos: pomodoros
        .filter((p) => p.start < dayEnd && p.end > dayStart)
        .map((p) => {
          const from = Math.max(0, minutesInto(p.start, dayStart));
          const to = Math.min(24 * 60, minutesInto(p.end, dayStart));
          return { pomodoro: p, top: px(from), height: Math.max(px(to - from), 2) };
        }),
      draft:
        draft && draft.start < dayEnd && draft.end > dayStart
          ? {
              top: px(Math.max(0, minutesInto(draft.start, dayStart))),
              height: px(Math.min(24 * 60, minutesInto(draft.end, dayStart)) - Math.max(0, minutesInto(draft.start, dayStart))),
              label: `${fmtTime(draft.start)}–${fmtTime(draft.end)} · ${fmtHM((draft.end - draft.start) / 1000)}`,
            }
          : null,
    };
  });
  const rangeTotal = columns.reduce((sum, c) => sum + c.total, 0);

  // Open at the first thing logged in view (an hour before it), else at 8 in the morning. Only when the
  // days shown change, not on every tick of a running timer.
  const rangeKey = `${mode}:${dayKey(first)}`;
  const earliest = Math.min(...columns.flatMap((c) => [...c.blocks.map((b) => b.top), ...c.ticked.map((t) => t.top)]));
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const target = Number.isFinite(earliest) ? Math.min(earliest, 8 * HOUR + HOUR) - HOUR : 8 * HOUR;
    el.scrollTop = Math.max(0, target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  const title =
    mode === "day"
      ? format(first, "EEEE d MMMM")
      : first.getMonth() === last.getMonth()
        ? `${format(first, "MMM d")} – ${format(last, "d")}`
        : `${format(first, "MMM d")} – ${format(last, "MMM d")}`;

  const dragging = Boolean(drag);
  const dragCursor = drag?.kind === "move" ? "grabbing" : drag?.kind === "create" ? "cell" : "ns-resize";

  return (
    <section className="flex h-full min-w-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
        {viewSwitch}
        <h2 className="min-w-0 truncate font-serif text-[17px] font-semibold">
          {title} <span className="figures font-normal text-muted">{format(last, "yyyy")}</span>
        </h2>
        <div className="ml-auto flex shrink-0 items-center">
          <NavButton label={mode === "day" ? "Previous day" : "Previous week"} onClick={() => onNavigate(addDays(date, -step))}>
            <ChevronLeft size={17} />
          </NavButton>
          <button
            onClick={() => onNavigate(today)}
            className="h-8 px-2.5 text-[13px] font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            Today
          </button>
          <NavButton label={mode === "day" ? "Next day" : "Next week"} onClick={() => onNavigate(addDays(date, step))}>
            <ChevronRight size={17} />
          </NavButton>
        </div>
      </div>
      <p className="shrink-0 font-serif text-xs italic text-muted">
        {fmtHM(rangeTotal)} {mode === "day" ? "logged" : "this week"}
        <span className="max-sm:hidden"> · drag a block to move it, its edges to change its times</span>
      </p>

      <div className="mt-2 flex min-h-0 flex-1 flex-col border border-line">
        {/* Day headings */}
        <div className="grid shrink-0 border-b border-line-strong" style={{ gridTemplateColumns: `3rem repeat(${days.length}, minmax(0, 1fr))` }}>
          <div />
          {columns.map((c) => {
            const isToday = c.key === todayKey;
            return (
              <button
                key={c.key}
                onClick={() => onOpenDay(c.day)}
                disabled={mode === "day"}
                className="flex min-w-0 flex-col items-center border-l border-line py-1.5 transition-colors enabled:hover:bg-surface-2"
                aria-label={`${format(c.day, "EEEE, MMMM d")}: ${fmtHM(c.total)}${mode === "day" ? "" : ". Open this day"}`}
              >
                <span className="text-[11px] text-faint">
                  <span className="sm:hidden">{format(c.day, "EEEEE")}</span>
                  <span className="max-sm:hidden">{format(c.day, "EEE")}</span>
                </span>
                <span
                  className={`figures grid size-7 place-items-center text-[15px] font-semibold ${
                    isToday ? "rounded-full bg-accent text-bg" : ""
                  }`}
                >
                  {c.day.getDate()}
                </span>
                <span className="figures h-4 text-[11px] text-muted">{c.total >= 60 ? fmtHM(c.total) : ""}</span>
              </button>
            );
          })}
        </div>

        {/* The hours */}
        <div ref={scroller} className="relative min-h-[22rem] flex-1 overflow-y-auto">
          <div
            ref={gridRef}
            className="relative grid select-none"
            style={{ gridTemplateColumns: `3rem repeat(${days.length}, minmax(0, 1fr))`, height: DAY_PX }}
          >
            <div className="relative" aria-hidden="true">
              {Array.from({ length: 23 }, (_, i) => (
                <span key={i} className="figures absolute right-1.5 -translate-y-1/2 text-[10px] text-faint" style={{ top: (i + 1) * HOUR }}>
                  {hourLabel(i + 1)}
                </span>
              ))}
            </div>

            {columns.map((c, index) => (
              <DayColumn
                key={c.key}
                index={index}
                column={c}
                mode={mode}
                chip={chip}
                now={now}
                isToday={c.key === todayKey}
                projectsById={projectsById}
                todoText={todoText}
                dragId={drag?.id}
                suppressClick={suppressClick}
                onGrab={begin}
                onEditSession={onEditSession}
                onAddSpan={onAddSpan}
              />
            ))}

            {/* While something is dragged, one cursor for the whole grid */}
            {dragging && <div className="absolute inset-0 z-30" style={{ cursor: dragCursor }} aria-hidden="true" />}
          </div>
        </div>
      </div>
    </section>
  );
}

function DayColumn({ index, column, mode, chip, now, isToday, projectsById, todoText, dragId, suppressClick, onGrab, onEditSession, onAddSpan }) {
  const { dayStart, blocks, ticked, pomos, draft } = column;
  const wide = mode === "day";
  // A single day gives the to-dos ticked off a lane of their own down the right; in a week the columns are
  // too narrow to share, so their marks sit over the sessions' right edge
  const lane = wide && ticked.length ? "40%" : "0px";
  const noMenu = (e) => e.pointerType !== "mouse" && e.preventDefault(); // a long press is a grab, not a menu

  const addAt = (e) => {
    if (e.target !== e.currentTarget || suppressClick.current) return;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const minutes = Math.floor((y / HOUR) * (60 / SLOT)) * SLOT;
    const at = atMinutes(dayStart, minutes);
    if (at < now) onAddSpan({ start: at });
  };

  return (
    <div
      data-day-col
      className="relative border-l border-line"
      style={{
        backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 ${HOUR - 1}px, var(--rule) ${HOUR - 1}px ${HOUR}px)`,
      }}
    >
      {/* Clicking an empty spot logs time from there; dragging down it logs that stretch */}
      <div
        className="absolute inset-0 cursor-cell"
        style={isToday ? { background: tint("var(--accent)", 4) } : undefined}
        onPointerDown={(e) => e.target === e.currentTarget && onGrab(e, "create", index)}
        onClick={addAt}
        onContextMenu={noMenu}
        title="Click to log time from here, or drag over the time to log"
      />

      {/* Pomodoros: a strip down the left edge */}
      {pomos.map(({ pomodoro: p, top, height }) => (
        <div
          key={p.id}
          className="pointer-events-auto absolute left-0 w-[3px]"
          style={{ top, height, background: p.completed ? "var(--accent)" : "var(--line-strong)" }}
          title={`Pomodoro ${fmtTime(p.start)}–${fmtTime(p.end)}${p.completed ? "" : ", cut short"}`}
        />
      ))}

      {/* Sessions */}
      <div className="pointer-events-none absolute inset-y-0 left-[5px]" style={{ right: `calc(${lane} + 3px)` }}>
        {blocks.map(({ session: s, top, height, lane: i, lanes }) => {
          const project = projectsById.get(s.project_id);
          const Icon = iconFor(project.icon);
          const running = !s.end;
          const open = Boolean(s.openItem); // an open item: still going, opened (not dragged) on a click
          const lifted = s.id === dragId;
          const roomy = height >= 34 || lifted;
          const startsHere = minutesInto(s.start, dayStart) >= 0;
          const endsHere = !running && minutesInto(s.end, dayStart) <= 24 * 60;
          // The to-do a project's session was timed on
          const onTodo = project.kind !== "task" && s.todo_id ? todoText.get(s.todo_id) : null;
          return (
            <button
              key={s.id}
              onPointerDown={(e) => !running && onGrab(e, "move", index, s)}
              onClick={() => (open || !running) && !suppressClick.current && onEditSession(s)}
              onContextMenu={noMenu}
              className={`group/block pointer-events-auto absolute flex flex-col overflow-hidden border-l-[3px] px-1.5 text-left transition-[filter] hover:brightness-110 ${
                running && !open ? "cursor-default" : "cursor-pointer"
              } ${open ? "border-b border-b-dashed" : ""} ${roomy ? "py-1" : "justify-center"} ${lifted ? "z-20 shadow-[0_6px_18px_rgb(0_0_0/0.35)] ring-1 ring-text/60" : ""}`}
              style={{
                top,
                height,
                left: lifted ? 0 : `calc(${(i / lanes) * 100}% + ${i ? 1 : 0}px)`,
                width: lifted ? "100%" : `calc(${100 / lanes}% - 1px)`,
                borderColor: project.color,
                background: lifted ? `color-mix(in srgb, ${project.color} 40%, var(--bg))` : tint(project.color, 26),
              }}
              title={`${project.name}${onTodo ? `: ${onTodo}` : ""}, ${fmtTime(s.start)}–${running ? "now" : fmtTime(s.end)} (${fmtHM(sessionSeconds(s, now))})${s.note ? `\n${s.note}` : ""}`}
              aria-label={`${project.name}, ${fmtTime(s.start)} to ${open ? "now, open" : running ? "now" : fmtTime(s.end)}${running && !open ? "" : ". Edit"}`}
            >
              {height >= 16 && (
                <span className="flex min-w-0 items-center gap-1 text-[11px] leading-tight font-semibold">
                  {wide && <Icon size={12} className="shrink-0" style={{ color: inkText(project.color) }} aria-hidden="true" />}
                  {open ? (
                    <Hourglass size={10} className="shrink-0 text-accent-2" aria-hidden="true" />
                  ) : (
                    running && <span className="blink-dot size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                  )}
                  <span className="truncate">{project.name}</span>
                </span>
              )}
              {roomy && (
                <span className={`figures truncate text-[10px] leading-tight ${lifted ? "font-semibold text-text" : "text-muted"}`}>
                  {fmtTime(s.start)}–{running ? "now" : fmtTime(s.end)}
                  {lifted && ` · ${fmtHM(sessionSeconds(s, now))}`}
                </span>
              )}
              {onTodo && height >= 46 && (
                <span className="truncate text-[10px] leading-tight">▸ {onTodo}</span>
              )}
              {wide && height >= 54 && s.note && (
                <span className="mt-0.5 line-clamp-2 font-serif text-[11px] leading-tight italic text-muted">{s.note}</span>
              )}

              {/* Edges to drag for a new start or end; a block cut at midnight keeps that edge where it is */}
              {!running && startsHere && height >= 28 && (
                <span
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onGrab(e, "start", index, s);
                  }}
                  className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize"
                  aria-hidden="true"
                />
              )}
              {endsHere && height >= 12 && (
                <span
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onGrab(e, "end", index, s);
                  }}
                  className="absolute inset-x-0 bottom-0 flex h-2 cursor-ns-resize justify-center"
                  aria-hidden="true"
                >
                  <span className="mt-[3px] h-[2px] w-4 bg-text/50 opacity-0 transition-opacity group-hover/block:opacity-100" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* A stretch being dragged out over an empty spot, to log */}
      {draft && (
        <div
          className="pointer-events-none absolute right-[3px] left-[5px] z-20 flex flex-col border border-dashed border-accent-2 px-1.5 py-1 text-[10px]"
          style={{ top: draft.top, height: draft.height, background: tint("var(--accent-2)", 18) }}
          aria-hidden="true"
        >
          <span className="figures truncate font-semibold">{draft.label}</span>
        </div>
      )}

      {/* To-dos ticked off */}
      <div className="pointer-events-none absolute inset-y-0 right-0 z-[5]" style={{ width: wide ? lane : chip }}>
        {ticked.map(({ todo, at, top }) => {
          const project = projectsById.get(todo.project_id);
          return wide ? (
            <div
              key={todo.id}
              className="pointer-events-auto absolute inset-x-1 flex items-center gap-1.5 border px-1.5 text-[11px]"
              style={{ top, height: chip, borderColor: tint(project.color, 45), background: "var(--surface)" }}
              title={`${todo.text}, ${project.name}, done ${fmtTime(at)}`}
            >
              <Check size={11} className="shrink-0" style={{ color: inkText(project.color) }} aria-hidden="true" />
              <span className="figures shrink-0 text-muted">{fmtTime(at)}</span>
              <span className="min-w-0 truncate">{todo.text}</span>
            </div>
          ) : (
            <div
              key={todo.id}
              className="pointer-events-auto absolute right-0.5 grid place-items-center"
              style={{ top, width: chip - 2, height: chip - 2, background: project.color, color: "var(--bg)" }}
              title={`${todo.text}, ${project.name}, done ${fmtTime(at)}`}
              role="img"
              aria-label={`Done at ${fmtTime(at)}: ${todo.text}`}
            >
              <Check size={9} strokeWidth={3} aria-hidden="true" />
            </div>
          );
        })}
      </div>

      {isToday && (
        <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: px(minutesInto(now, dayStart)) }} aria-hidden="true">
          <span className="-ml-1 size-2 rounded-full bg-accent" />
          <span className="h-[2px] flex-1 bg-accent" />
        </div>
      )}
    </div>
  );
}

function NavButton({ label, onClick, children }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="grid size-8 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
    >
      {children}
    </button>
  );
}
