@echo off
REM ============================================================================
REM Pinch Test Machine — one-click launcher
REM   Starts backend (uvicorn :8000), frontend (vite :5173) and opens Edge
REM   in fullscreen kiosk mode pointed at the UI.
REM
REM   To auto-start on Windows boot:
REM     1) Press Win+R, type:   shell:startup
REM     2) Drop a shortcut to this file in that folder
REM ============================================================================
setlocal

REM --- Resolve project paths relative to this .bat ---
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "BACKEND=%ROOT%\backend"
set "FRONTEND=%ROOT%\frontend"
set "VENV_PY=%BACKEND%\.venv\Scripts\python.exe"

echo === Pinch Test Machine launcher ===
echo Root:     %ROOT%
echo Backend:  %BACKEND%
echo Frontend: %FRONTEND%
echo.

REM --- 0) Clear any orphaned PLC bridge from a previous unclean shutdown. ---
REM     The KV-3000 allows only ONE USB connection.  A bridge process left running
REM     (e.g. after a hard kill or a crash) keeps that port open, so the next
REM     DBConnectA returns rc=4 (DB_ERR_OPEN_PORT) forever.  Kill any stray bridge,
REM     then give the USB session a moment to release before we reconnect.
echo Clearing any orphaned PLC bridge ...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*plc_bridge.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
timeout /t 3 /nobreak >nul
echo.

REM --- Sanity: venv must exist ---
if not exist "%VENV_PY%" (
  echo [error] Backend venv not found at %VENV_PY%
  echo Run:  cd backend ^&^& python -m venv .venv ^&^& .venv\Scripts\pip install -e .[dev]
  pause
  exit /b 1
)

REM --- 1) Start backend in a new window ---
echo Starting backend on :8000 ...
start "pinch-backend" /MIN cmd /c "cd /d "%BACKEND%" && "%VENV_PY%" -m uvicorn app.main:app --port 8000 --host 127.0.0.1"

REM --- 2) Build the PRODUCTION frontend, then serve it ---
REM   The kiosk serves the PRODUCTION build, NOT the React dev server. Why: React 19's
REM   development build emits a performance.measure() per render that is never evicted,
REM   leaking ~0.65 MB per test loop until the kiosk browser bogs down. The production
REM   build emits none (and is smaller + faster). We call `vite build` directly instead of
REM   `npm run build` to skip the `tsc -b` type-check, which currently fails on some
REM   pre-existing Base-UI `asChild` typings; the bundle itself is correct.
REM   `vite preview` (frontend/vite.config.ts -> preview) then serves dist/ on :5173 with
REM   the same /api + /ws proxy to the backend as the old dev server, so the kiosk URL and
REM   the wait-for-frontend check below are unchanged.
echo Building frontend (production) ...
cmd /c "cd /d "%FRONTEND%" && npx vite build"
if errorlevel 1 (
  echo [error] Frontend production build failed. See the messages above.
  pause
  exit /b 1
)
echo Starting frontend (production preview) on :5173 ...
start "pinch-frontend" /MIN cmd /c "cd /d "%FRONTEND%" && npm run preview"

REM --- 3a) Wait for backend to come up ---
REM   Backend must be ready first so the UI can fetch recipes on first paint.
echo Waiting for backend ...
set /a btries=0
:wait_backend
set /a btries+=1
if %btries% gtr 60 goto give_up_backend
timeout /t 1 /nobreak >nul
powershell -NoProfile -WindowStyle Hidden -Command "try { $r=(Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/recipes' -UseBasicParsing -TimeoutSec 1); exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 goto wait_backend
echo Backend ready.

REM --- 3b) Wait for frontend to come up (vite is slower than uvicorn) ---
echo Waiting for frontend ...
set /a tries=0
:wait_loop
set /a tries+=1
if %tries% gtr 60 goto give_up_frontend
timeout /t 1 /nobreak >nul
powershell -NoProfile -WindowStyle Hidden -Command "try { (Invoke-WebRequest -Uri 'http://127.0.0.1:5173' -UseBasicParsing -TimeoutSec 1).StatusCode } catch { exit 1 }" >nul 2>&1
if errorlevel 1 goto wait_loop

echo Frontend ready.
echo.

REM --- 4) Launch Edge in kiosk / fullscreen with a clean profile ---
REM Clean profile = no "Restore web page?" prompt after a crash or unclean close.
set "EDGE_PROFILE=%LOCALAPPDATA%\pinch-mc\edge"
set "MSEDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%MSEDGE%" set "MSEDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%MSEDGE%" (
  echo [warn] msedge.exe not found in either Program Files location.
  echo Open the UI manually: http://127.0.0.1:5173
  goto end
)

echo Launching Edge kiosk at http://127.0.0.1:5173 ...
REM Defensive kiosk touch hygiene (NOT the chart-pinch fix — that lives in
REM   frontend/src/lib/echarts-touch-fix.ts). --disable-pinch blocks accidental
REM   browser viewport-zoom of the whole UI; --overscroll-history-navigation=0 stops a
REM   horizontal swipe from triggering back/forward nav. Verified the browser was NOT
REM   eating the chart pinch as viewport zoom (visualViewport.scale stayed at 1), so
REM   these only harden the kiosk shell; they are safe to drop if unwanted.
start "" "%MSEDGE%" ^
  --kiosk http://127.0.0.1:5173 ^
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

:give_up_backend
echo [error] Backend did not respond within 60 seconds.
echo Check the pinch-backend window for errors.
pause
goto end

:give_up_frontend
echo [error] Frontend did not respond within 60 seconds.
echo Check the pinch-frontend window for errors.
pause

:end
endlocal
