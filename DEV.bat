@echo off
title ProjectsTracker Dev
setlocal
cd /d "%~dp0"

rem DEV.bat        start the API and the web server in the background, open the page, close this window
rem DEV.bat stop   stop both background servers

:: --- Configuration ---
set BACKEND_PORT=8001
set FRONTEND_PORT=5174
set FRONTEND_DIR=frontend

if /i "%~1"=="stop" goto :stop

:: 1. Free the ports in case a previous run is still holding them.
call :FREE_PORTS

:: 2. Make sure setup has been done at least once
if not exist .venv goto :FAIL_MSG
if not exist "%FRONTEND_DIR%\node_modules" goto :FAIL_MSG

:: 3. Start both servers hidden. Their output goes to dev-api.log and dev-web.log.
:: Vite opens the browser by itself once it's ready.
powershell -NoProfile -Command "Start-Process -WindowStyle Hidden -FilePath cmd.exe -ArgumentList '/c .venv\Scripts\python.exe -m uvicorn backend.main:app --reload --port %BACKEND_PORT% > dev-api.log 2>&1' -WorkingDirectory '%~dp0'"
powershell -NoProfile -Command "Start-Process -WindowStyle Hidden -FilePath cmd.exe -ArgumentList '/c npm run dev -- --open > ..\dev-web.log 2>&1' -WorkingDirectory '%~dp0%FRONTEND_DIR%'"

:: "exit" (not "exit /b") closes the window even when this was started from an open prompt.
exit

:stop
call :FREE_PORTS
echo Dev servers stopped.
goto :eof

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
exit /b 1
