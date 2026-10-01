# ProjectsTracker
**FastAPI · SQLAlchemy · React 19 · Vite · Tailwind 4**

A visual time tracker for your projects: one-click timers, a month calendar that fills up
with the time you worked, and a year-long activity heatmap.

## Features

- **One screen, three tabs**: *Projects*, *Calendar* and *Stats* each fit the window, so there is no
  page scrolling; a list only scrolls inside its own box when it really has more than fits. The
  landing page works the same way (*Try it*, *How it works*, *Ask for your own*).
- **Status board**: every status is a column and every project a card with a big ▶/■ timer button,
  live clock, today and total time, a 7-day sparkline, and its open to-dos. Drag a card to another
  column to change its status. Touch screens can't drag, so each card's menu has *Move to*, and phones
  show one status at a time.
- **Statuses**: a list you manage yourself (the **Statuses** button on the Projects tab): Active, On
  hold, Idea, ... Each project has one. Tick *Finished* on the statuses that mean it's over: projects
  there lose their timer. A fresh database starts with Active and Done.
- **Notes and to-dos per project**: click a project's name to open it. It holds a checklist of
  to-dos, free-form notes (saved as you leave the box) and the sessions logged on it, on three tabs.
  Cards show how many to-dos are open and a notebook mark when there are notes.
- **One timer at a time**: starting a project stops whatever was running. Timers live on the
  server, so they survive reloads and keep counting with the tab closed. The running timer is
  always in the header pill and the browser tab title.
- **Session notes**: write a note while the timer runs (the notebook button on the timer pill in the
  header) or when you add time by hand. Both end up on the same session.
- **Manual entries**: log time after the fact without fiddling with clock pickers. Say which day it
  ended, then type any of start, end or duration (`9`, `5pm`, `1h30`, `90`) and the others follow, or
  tap a quick-duration chip or *now*. Overnight sessions are supported. Edit or delete any session.
- **Month calendar** (Calendar tab): each day "fills" with stacked project colors proportional to
  time worked. Click a day to see its sessions.
- **Activity heatmap** (Stats tab): up to 53 weeks, as many as fit the width, filterable by project.
  Click a square to jump the calendar there.
- **Stats strip**: today, this week, streak, open projects, and the open project that has gone longest
  without a session ("most neglected").
- Light/dark theme, responsive down to phone width.

## Quick start

### 1. Backend

```bash
python -m venv .venv
.venv\Scripts\activate     # Windows
source .venv/bin/activate  # Mac/Linux

pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8001
```

The SQLite database is created automatically at `backend/tracker.db`.
To use Postgres (e.g. Neon) instead, copy `.env.example` to `.env` and set `DATABASE_URL`.

### 2. Frontend (new terminal)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5174. Vite proxies `/api` to the backend on port 8001.

### 3. One-click launch (after setup)

Double-click `dev.bat` to open both servers in Windows Terminal and launch the browser.

Ports 8001/5174 are used so this can run next to Daily-Checklist (8000/5173).

**If the API seems to run old code** (for example `http://localhost:5174/api/auth/me` answers 404, or
the footer lock asks for a password when none is set): a leftover uvicorn worker is still holding
port 8001. On Windows, killing the `--reload` supervisor leaves its worker running, and two servers
can bind the same port, with the older one winning the traffic. `dev.bat` now stops these orphans
before starting. To clear one by hand:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'spawn_main' } | Select-Object ProcessId, ParentProcessId, CreationDate
Stop-Process -Id <ProcessId of the old one>
```

## Tests

```bash
pip install -r requirements-dev.txt
pytest
```

## Public site and private tracker

`/` is a public landing page. Its demo is the real interface running on in-memory sample data
(`frontend/src/demo/demoApi.js`), so visitors can play without touching any database. A small lock
icon in the footer opens the owner sign-in; after signing in, the same page becomes your real tracker.

- **`OWNER_PASSWORD`** (env var) is the owner login. Every data route requires the session cookie it
  creates (HttpOnly, SameSite=Strict, 30 days). Changing the password signs every session out.
- On Vercel, if it is missing, the data routes answer 503 on purpose: a forgotten variable never
  leaves your data open.

**Locally.** `http://localhost:5174` opens the landing page like it does for visitors. With
`OWNER_PASSWORD` empty (the default) the login is off: the lock icon in the footer takes you straight
into your tracker, and the exit button in the tracker's header ("Back to the public page") returns
you to the landing page. To try the real login, put `OWNER_PASSWORD=...` in `.env` (see
`.env.example`) and restart the API.

**The "I'd use this" counter.** It stores one random browser id per vote and caps new votes at 60
per 10 minutes, so it is a soft signal, not a tamper-proof count. After pressing it, a visitor can
optionally leave an email (to be replied to) and/or a note. Those go into the `interest_messages`
table, which is created automatically, and only the owner can read them: the **Interest** button in
the tracker's header opens the inbox (the badge counts notes you haven't opened yet), with a reply
link and a delete button per note. An email address is personal data, so delete a note when someone
asks you to; deleting it leaves their vote counted.

## API

All routes are under `/api`. Everything except `/health`, `/auth/*`, `/interest` and
`/interest/message` needs the owner session. Times are ISO-8601. The server stores UTC and returns
it with a `Z`, and the browser groups by local day.

| Method | Path | Purpose |
|---|---|---|
| GET | `/projects` | List projects with `total_seconds` (closed sessions) |
| POST / PATCH / DELETE | `/projects[/{id}]` | Create / edit / delete (deletes its sessions and to-dos). Carries `status_id` and `notes` |
| GET / POST / PATCH / DELETE | `/todos[/{id}]` | A project's to-dos: `{project_id, text}`, then `{text?, done?}`. GET lists everyone's |
| GET / POST / PATCH / DELETE | `/statuses[/{id}]` | Manage statuses (`is_done` marks the finished ones). Refuses (409) to delete a status in use or to leave no unfinished status |
| GET | `/sessions?start=&end=` | Sessions overlapping a range |
| POST / PATCH / DELETE | `/sessions[/{id}]` | Manual add / edit / delete |
| GET | `/timer` | The running session, or `null` |
| POST | `/timer/start` | `{project_id}`: stops the current timer, starts this one |
| POST | `/timer/stop` | Stops the running timer |
| GET | `/auth/me` | `{authenticated, required}`: is there a valid owner session |
| POST | `/auth/login` | `{password}`: sets the session cookie (204) |
| POST | `/auth/logout` | Clears the session cookie (204) |
| GET / POST | `/interest` | Public counter: `{count}`; POST `{visitor_id}` registers one "I'd use this" |
| POST | `/interest/message` | Public: `{visitor_id, email?, message?}`, at least one of the two; sending again replaces the earlier note |
| GET | `/interest/messages` | Owner only: `{count, messages}`, newest first |
| DELETE | `/interest/messages/{visitor_id}` | Owner only: erase one note (the vote stays) |

## File structure

```
ProjectsTracker/
├── backend/            FastAPI app (main.py), models, schemas, database setup (bootstrap.py
│                       also upgrades a database made by an older version)
├── tests/              pytest suite for the API
├── frontend/
│   └── src/
│       ├── App.jsx           public site / owner switch (login state)
│       ├── Tracker.jsx       the tracker itself: page layout + modal wiring
│       ├── api.js            fetch client (data, auth, interest)
│       ├── landing/          landing page, interest widget, owner sign-in dialog
│       ├── demo/             in-memory demo API with seeded sample data
│       ├── hooks/            useTracker (state + mutations), useNow (live clock),
│       │                     useTheme, useInterest (visitors), useInbox (owner)
│       ├── lib/              time math (per-day splitting, streaks, formatting), palette
│       └── components/       Header, TabBar, ProjectBoard (status columns, drag and drop),
│                             StatsStrip, MonthCalendar, DayPanel, Heatmap, ProjectModal,
│                             ProjectDetail (notes and to-dos), StatusModal, SessionModal, …
├── dev.bat             launcher
└── requirements*.txt
```

## Not in v1 (yet)

- Multiple users: login is a single owner password, and data is not split per account
- Goals or budgets per project
- CSV export
