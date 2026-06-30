@echo off
REM ============================================================================
REM Pinch Test Machine - DOCKER launcher (frontend in a container, backend native)
REM
REM   Backend  : runs NATIVELY on Windows (uvicorn :8000) - it needs COM ports, the USB
REM              PLC, and the 32-bit DataBuilder.dll bridge, none of which a container can
REM              access. So the backend is intentionally NOT containerized.
REM   Frontend : runs in Docker (nginx serving the PRODUCTION build) on :8080, proxying
REM              /api + /ws to the host backend. The production build emits none of React's
REM              dev-build performance.measure() entries -> the in-loop heap leak is gone.
REM
REM   ONE-TIME setup:
REM     1) Install Docker Desktop as Administrator:
REM          winget install -e --id Docker.DockerDesktop
REM        Reboot, launch Docker Desktop once, accept the agreement, enable the WSL2 engine.
REM     2) Docker Desktop > Settings > General: tick "Start Docker Desktop when you log in".
REM        With restart:always (docker-compose.yml) the container then auto-starts on boot.
REM     3) Build + start the image once:
REM          docker compose up -d --build frontend
REM     4) Auto-start the whole kiosk: put a shortcut to THIS file in shell:startup
REM        (Win+R -> shell:startup). Rebuild after frontend code changes with:
REM          docker compose up -d --build frontend
REM ============================================================================
setlocal

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "BACKEND=%ROOT%\backend"
set "VENV_PY=%BACKEND%\.venv\Scripts\python.exe"

echo === Pinch Test Machine launcher (Docker frontend) ===
echo Root: %ROOT%
echo.

REM --- 0) Clear any orphaned PLC bridge from a previous unclean shutdown ---
echo Clearing any orphaned PLC bridge ...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*plc_bridge.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
timeout /t 3 /nobreak >nul

if not exist "%VENV_PY%" (
  echo [error] Backend venv not found at %VENV_PY%
  pause
  exit /b 1
)

REM --- 1) Start backend (native Windows) ---
echo Starting backend on :8000 ...
start "pinch-backend" /MIN cmd /c "cd /d "%BACKEND%" && "%VENV_PY%" -m uvicorn app.main:app --port 8000 --host 127.0.0.1"

REM --- 2) Wait for the Docker engine, then ensure the frontend container is up ---
echo Waiting for Docker engine (is Docker Desktop running?) ...
set /a dtries=0
:wait_docker
set /a dtries+=1
if %dtries% gtr 120 goto give_up_docker
docker info >nul 2>&1
if errorlevel 1 (
  timeout /t 2 /nobreak >nul
  goto wait_docker
)
echo Docker engine ready. Ensuring frontend container ...
docker compose -f "%ROOT%\docker-compose.yml" up -d frontend

REM --- 3a) Wait for backend ---
echo Waiting for backend ...
set /a btries=0
:wait_backend
set /a btries+=1
if %btries% gtr 60 goto give_up_backend
timeout /t 1 /nobreak >nul
powershell -NoProfile -WindowStyle Hidden -Command "try { $r=(Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/recipes' -UseBasicParsing -TimeoutSec 1); exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 goto wait_backend
echo Backend ready.

REM --- 3b) Wait for frontend container ---
echo Waiting for frontend (container) ...
set /a ftries=0
:wait_frontend
set /a ftries+=1
if %ftries% gtr 60 goto give_up_frontend
timeout /t 1 /nobreak >nul
powershell -NoProfile -WindowStyle Hidden -Command "try { $r=(Invoke-WebRequest -Uri 'http://127.0.0.1:8080' -UseBasicParsing -TimeoutSec 1); exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 goto wait_frontend
echo Frontend ready.
echo.

REM --- 4) Launch Edge in kiosk mode at the CONTAINER url (:8080) ---
set "EDGE_PROFILE=%LOCALAPPDATA%\pinch-mc\edge"
set "MSEDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%MSEDGE%" set "MSEDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%MSEDGE%" (
  echo [warn] msedge.exe not found. Open the UI manually: http://127.0.0.1:8080
  goto end
)
echo Launching Edge kiosk at http://127.0.0.1:8080 ...
start "" "%MSEDGE%" ^
  --kiosk http://127.0.0.1:8080 ^
  --edge-kiosk-type=fullscreen ^
  --disable-pinch ^
  --overscroll-history-navigation=0 ^
  --no-first-run ^
  --no-default-browser-check ^
  --disable-session-crashed-bubble ^
  --disable-features=ExtensionsToolbarMenu,InfiniteSessionRestore,TranslateUI ^
  --user-data-dir="%EDGE_PROFILE%" ^
  --hide-crash-restore-bubble
goto end

:give_up_docker
echo [error] Docker engine did not become ready. Install/start Docker Desktop first.
pause
goto end
:give_up_backend
echo [error] Backend did not respond within 60 seconds. Check the pinch-backend window.
pause
goto end
:give_up_frontend
echo [error] Frontend container did not respond. Check: docker compose logs frontend
pause
:end
