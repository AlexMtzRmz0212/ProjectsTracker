@echo off
title ProjectsTracker Dev
setlocal

:: --- Configuration ---
set BACKEND_PORT=8001
set FRONTEND_PORT=5174
set FRONTEND_DIR=frontend

echo ============================================
echo   PROJECTS TRACKER - DEV ENVIRONMENT
echo ============================================

:: 1. Free the ports in case a previous run is still holding them.
echo [1/3] Clearing ports %BACKEND_PORT% and %FRONTEND_PORT%...
call :FREE_PORTS

:: 2. Make sure setup has been done at least once
echo [2/3] Validating environment...
if not exist .venv goto :FAIL_MSG
if not exist "%FRONTEND_DIR%\node_modules" goto :FAIL_MSG

:: 3. API and web in this one window: the API in the background (its log lines show here too),
:: the web server in front. Vite opens the browser once it's ready.
:: Ctrl+C or closing the window stops both.
echo [3/3] Starting API (port %BACKEND_PORT%) and web (port %FRONTEND_PORT%)...
echo       Ctrl+C or closing this window stops both.
echo.
start "" /b ".venv\Scripts\python.exe" -m uvicorn backend.main:app --reload --port %BACKEND_PORT%
pushd "%FRONTEND_DIR%"
call npm run dev -- --open
popd

:: The web server has stopped: make sure the API went with it
call :FREE_PORTS
exit /b

:: A listening socket can outlive the process netstat reports for it: when uvicorn's
:: --reload supervisor is killed, its worker keeps the port and keeps serving old code.
:: So stop each listener's child processes first (this also catches orphans of a PID
:: that is already gone), then the listener itself.
:FREE_PORTS
for %%p in (%BACKEND_PORT% %FRONTEND_PORT%) do (
  for /f "tokens=5" %%a in ('netstat -aon ^| findstr :%%p ^| findstr LISTENING') do (
    powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter 'ParentProcessId=%%a' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
    taskkill /f /t /pid %%a >nul 2>&1
  )
)
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
