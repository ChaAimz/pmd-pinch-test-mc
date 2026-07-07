@echo off
REM ============================================================================
REM build.bat — Build pinch-tray.exe with PyInstaller
REM
REM Output: C:\pinch-test-mc\pinch-tray.exe
REM
REM Prerequisites:
REM   - Run this from the repo root OR from tray\ (auto-detected)
REM   - backend\.venv must already exist (run setup first if not)
REM
REM Usage:
REM   cd <repo-root>
REM   tray\build.bat
REM ============================================================================
setlocal

REM --- Resolve repo root (this .bat lives in <repo>\tray\) ---
set "TRAY=%~dp0"
if "%TRAY:~-1%"=="\" set "TRAY=%TRAY:~0,-1%"
set "ROOT=%TRAY%\.."
pushd "%ROOT%"
set "ROOT=%CD%"
popd

set "BACKEND=%ROOT%\backend"
set "VENV_PY=%BACKEND%\.venv\Scripts\python.exe"
set "VENV_PIP=%BACKEND%\.venv\Scripts\pip.exe"

set "DIST_DIR=C:\pinch-test-mc"
set "WORK_DIR=%TRAY%\build_work"

echo === Pinch Tray — build ===
echo Repo root : %ROOT%
echo Output    : %DIST_DIR%\pinch-tray.exe
echo.

REM --- Sanity: venv must exist ---
if not exist "%VENV_PY%" (
  echo [error] Venv not found: %VENV_PY%
  echo Run:  cd backend ^&^& python -m venv .venv ^&^& .venv\Scripts\pip install -e .[dev]
  exit /b 1
)

REM --- Install tray requirements into the BACKEND venv ---
echo Installing tray requirements into backend venv ...
"%VENV_PIP%" install -r "%TRAY%\requirements.txt" --quiet
if errorlevel 1 (
  echo [error] pip install failed.
  exit /b 1
)
echo Requirements installed.
echo.

REM --- Create output directory if it does not exist ---
if not exist "%DIST_DIR%" (
  echo Creating output directory: %DIST_DIR%
  mkdir "%DIST_DIR%"
)

REM --- Run PyInstaller ---
echo Running PyInstaller ...
REM Note: --specpath is not valid when passing a .spec file directly.
REM The spec file path is given explicitly; PyInstaller reads it from that location.
"%VENV_PY%" -m PyInstaller ^
  --noconfirm ^
  --distpath "%DIST_DIR%" ^
  --workpath "%WORK_DIR%" ^
  "%TRAY%\pinch_tray.spec"

if errorlevel 1 (
  echo.
  echo [error] PyInstaller build failed. See output above.
  exit /b 1
)

echo.
echo === Build complete ===
echo EXE : %DIST_DIR%\pinch-tray.exe
echo.

REM --- Drop a sample pinch-tray.ini if one does not exist yet ---
if not exist "%DIST_DIR%\pinch-tray.ini" (
  echo Writing sample config: %DIST_DIR%\pinch-tray.ini
  (
    echo [pinch]
    echo ; Absolute path to the git repo root.
    echo ; Adjust if you clone the repo to a different location.
    echo root = %ROOT%
  ) > "%DIST_DIR%\pinch-tray.ini"
  echo Written.
)

echo.
echo Next steps:
echo   1) Run:  powershell -File "%TRAY%\install_autostart.ps1"
echo      to add pinch-tray.exe to the Windows Startup folder.
echo   2) Log out and back in (or run C:\pinch-test-mc\pinch-tray.exe manually).
echo   3) Ensure Docker Desktop is set to "Start when you log in" so the
echo      frontend container auto-starts before the tray app polls it.
echo.
endlocal
