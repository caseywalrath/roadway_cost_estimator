@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "URL=http://127.0.0.1:4180/"
set "HEALTH=http://127.0.0.1:4180/api/health"

rem Reuse this monitor if port 4180 is already serving it.
for /f "delims=" %%H in ('powershell.exe -NoProfile -Command "try { $r=Invoke-RestMethod -Uri '%HEALTH%' -TimeoutSec 2; if ($r.ok -eq $true) { 'READY' } } catch { }"') do (
  if "%%H"=="READY" (
    start "" "%URL%"
    echo An existing Data Source Monitor is already running. The browser was opened.
    exit /b 0
  )
)

set "PYTHON="
if exist "%ROOT%\.venv\Scripts\python.exe" set "PYTHON=%ROOT%\.venv\Scripts\python.exe"
if not defined PYTHON if exist "%ROOT%\venv\Scripts\python.exe" set "PYTHON=%ROOT%\venv\Scripts\python.exe"
if not defined PYTHON set "PYTHON=python"

echo Starting Data Source Monitor from %ROOT%
start "Roadway Cost Estimator Data Source Monitor" /D "%ROOT%" "%PYTHON%" -m tools.source_monitor.server --port 4180

set "READY="
for /l %%I in (1,1,30) do (
  if not defined READY for /f "delims=" %%H in ('powershell.exe -NoProfile -Command "try { $r=Invoke-RestMethod -Uri '%HEALTH%' -TimeoutSec 2; if ($r.ok -eq $true) { 'READY' } } catch { }"') do set "READY=%%H"
  if defined READY goto :open
  timeout /t 1 /nobreak >nul
)

echo The monitor did not become ready on port 4180.
echo Check the separate monitor window for the Python error. No process was stopped.
pause
exit /b 1

:open
start "" "%URL%"
echo Data Source Monitor is ready at %URL%
echo Keep the monitor window open while using the tool. Close it or press Ctrl+C to stop.
pause
