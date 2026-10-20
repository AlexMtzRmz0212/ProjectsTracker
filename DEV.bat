@echo off
title ProjectsTracker Launcher
setlocal

:: --- Configuration ---
set BACKEND_PORT=8001
set FRONTEND_PORT=5174
set FRONTEND_DIR=frontend

echo ============================================
echo   PROJECTS TRACKER - DEV ENVIRONMENT
echo ============================================

:: 1. Free the ports in case a previous run is still holding them.
:: A listening socket can outlive the process netstat reports for it: when uvicorn's
:: --reload supervisor is killed, its worker keeps the port and keeps serving old code.
:: So stop each listener's child processes first (this also catches orphans of a PID
:: that is already gone), then the listener itself.
echo [1/3] Clearing ports %BACKEND_PORT% and %FRONTEND_PORT%...
for %%p in (%BACKEND_PORT% %FRONTEND_PORT%) do (
  for /f "tokens=5" %%a in ('netstat -aon ^| findstr :%%p ^| findstr LISTENING') do (
    powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter 'ParentProcessId=%%a' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
    taskkill /f /t /pid %%a >nul 2>&1
  )
)

:: 2. Make sure setup has been done at least once
echo [2/3] Validating environment...
if not exist .venv goto :FAIL_MSG
if not exist "%FRONTEND_DIR%\node_modules" goto :FAIL_MSG

:: 3. Backend and frontend side by side in Windows Terminal.
:: If wt isn't on PATH (e.g. inside another app's terminal), fall back to two plain cmd windows.
echo [3/3] Launching terminals...
where wt >nul 2>&1
if %ERRORLEVEL% neq 0 goto :LAUNCH_FALLBACK
wt -w 0 nt --title "API" -d "." cmd /k "color 5F && .venv\Scripts\activate && uvicorn backend.main:app --reload --port %BACKEND_PORT%" ; ^
split-pane -V --title "Web" -d ".\%FRONTEND_DIR%" cmd /k "color 3F && npm run dev"
if %ERRORLEVEL% neq 0 goto :LAUNCH_FAIL
goto :BROWSER

:LAUNCH_FALLBACK
echo Windows Terminal (wt) not found - opening two separate windows instead.
:: Don't test %ERRORLEVEL% here: it still holds the failed "where wt" result, and start doesn't reset it.
start "API" /d "%CD%" cmd /k "color 5F && .venv\Scripts\activate && uvicorn backend.main:app --reload --port %BACKEND_PORT%" || goto :LAUNCH_FAIL
start "Web" /d "%CD%\%FRONTEND_DIR%" cmd /k "color 3F && npm run dev" || goto :LAUNCH_FAIL

:BROWSER

:: 4. Browser
timeout /t 4 /nobreak > NUL
start "" "http://localhost:%FRONTEND_PORT%"
echo Success!
exit /b

:LAUNCH_FAIL
echo.
echo ------------------------------------------------------------
echo [ERROR] Setup looks fine, but the dev terminals failed to launch.
echo Start them manually:
echo   API: .venv\Scripts\activate ^&^& uvicorn backend.main:app --reload --port %BACKEND_PORT%
echo   Web: cd %FRONTEND_DIR% ^&^& npm run dev
echo ------------------------------------------------------------
echo.
pause
exit /b

:FAIL_MSG
echo.
echo ------------------------------------------------------------
echo [ERROR] The environment failed to initialize.
echo Run the setup steps in README.md at least once
echo (python venv + pip install, and npm install in frontend).
echo ------------------------------------------------------------
echo.
pause
exit /b
