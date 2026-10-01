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

:: 1. Free the ports in case a previous run is still holding them
echo [1/3] Clearing ports %BACKEND_PORT% and %FRONTEND_PORT%...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :%BACKEND_PORT% ^| findstr LISTENING') do taskkill /f /pid %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :%FRONTEND_PORT% ^| findstr LISTENING') do taskkill /f /pid %%a >nul 2>&1

:: 2. Make sure setup has been done at least once
echo [2/3] Validating environment...
if not exist .venv goto :FAIL_MSG
if not exist "%FRONTEND_DIR%\node_modules" goto :FAIL_MSG

:: 3. Backend and frontend side by side in Windows Terminal
echo [3/3] Launching terminals...
wt -w 0 nt --title "API" -d "." cmd /k "color 5F && .venv\Scripts\activate && uvicorn backend.main:app --reload --port %BACKEND_PORT%" ; ^
split-pane -V --title "Web" -d ".\%FRONTEND_DIR%" cmd /k "color 3F && npm run dev"
if %ERRORLEVEL% neq 0 goto :FAIL_MSG

:: 4. Browser
timeout /t 4 /nobreak > NUL
start "" "http://localhost:%FRONTEND_PORT%"
echo Success!
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
