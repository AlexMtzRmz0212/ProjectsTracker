# ProjectsTracker
**FastAPI · SQLAlchemy · React 19 · Vite · Tailwind 4**

A visual time tracker for your projects: one-click timers, a month calendar that fills up
with the time you worked, and a year-long activity heatmap.

## Features

- **Project cards**: color + icon identity, big ▶/■ timer button, live clock, total time and a
  7-day sparkline. Mark a project *done* to tuck it into a collapsible section.
- **One timer at a time**: starting a project stops whatever was running. Timers live on the
  server, so they survive reloads and keep counting with the tab closed. The running timer is
  always in the header pill and the browser tab title.
- **Manual entries**: log time after the fact (quick 15m–4h chips, overnight sessions supported),
  edit or delete any session.
- **Month calendar**: each day "fills" with stacked project colors proportional to time worked.
  Click a day to see its sessions.
- **Activity heatmap**: the last 53 weeks, filterable by project. Click a square to jump the
  calendar there.
- **Stats strip**: today, this week, streak, active projects.
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

## Tests

```bash
pip install -r requirements-dev.txt
pytest
```

## API

All routes are under `/api`. Times are ISO-8601. The server stores UTC and returns it with a `Z`,
and the browser groups by local day.

| Method | Path | Purpose |
|---|---|---|
| GET | `/projects` | List projects with `total_seconds` (closed sessions) |
| POST / PATCH / DELETE | `/projects[/{id}]` | Create / edit / delete (deletes its sessions) |
| GET | `/sessions?start=&end=` | Sessions overlapping a range |
| POST / PATCH / DELETE | `/sessions[/{id}]` | Manual add / edit / delete |
| GET | `/timer` | The running session, or `null` |
| POST | `/timer/start` | `{project_id}`: stops the current timer, starts this one |
| POST | `/timer/stop` | Stops the running timer |

## File structure

```
ProjectsTracker/
├── backend/            FastAPI app (main.py), models, schemas, database setup
├── tests/              pytest suite for the API
├── frontend/
│   └── src/
│       ├── App.jsx           page layout + modal wiring
│       ├── api.js            fetch client
│       ├── hooks/            useTracker (state + mutations), useNow (live clock)
│       ├── lib/              time math (per-day splitting, streaks, formatting), palette
│       └── components/       Header, StatsStrip, ProjectCard/Grid, MonthCalendar,
│                             DayPanel, Heatmap, ProjectModal, SessionModal, …
├── dev.bat             launcher
└── requirements*.txt
```

## Not in v1 (yet)

- Authentication (single user, meant to run locally for now)
- Deployment (Vercel + Neon): the `/api` prefix and `DATABASE_URL` are already in place
- Tags, goals or budgets per project
- CSV export
