#Requires -Version 5.1
<#
.SYNOPSIS
    Assembles a FULLY SELF-CONTAINED Pinch Test Machine installation at
    C:\pinch-test-mc\  from the git repository.

.DESCRIPTION
    Run this script ONCE while the git repo still exists.  After it completes,
    the repo folder can be deleted and the system continues to run from
    C:\pinch-test-mc entirely.

    What it builds
    ---------------
    C:\pinch-test-mc\
      backend\                 -- FastAPI app (fresh venv, fully self-contained)
        app\                   -- Python source package
        alembic.ini
        pyproject.toml
        py32\                  -- 32-bit Python embed + plc_bridge.py
        plc_bridge.py          -- (also at root of backend, for backward compat)
        config.yaml            -- production config (same as repo; relative DB paths kept)
        data\                  -- NOT here; data lives one level up (see below)
        .venv\                 -- FRESH venv created at destination (not copied)
      data\                    -- pinch.db + waveforms (adjacent to backend)
      docker-compose.yml       -- image-only (no build: context; works after repo gone)
      pinch-tray.exe           -- built by PyInstaller (--windowed, onefile)
      pinch-tray.ini           -- [pinch] backend_dir / compose_file config
      install_autostart.ps1    -- adds tray exe to Startup; removes old .bat shortcuts
      uninstall_autostart.ps1  -- removes tray Startup shortcut
      README.md                -- operator guide

    External prerequisites (NOT bundled -- document only):
      - Docker Desktop (+ "Start when you log in" enabled)
      - KEYENCE KVComPlus: C:\Program Files (x86)\KEYENCE\KVComPlusLB\bin\DataBuilder.dll
      - Microsoft Edge (standard Windows install)

    The script is safe to re-run -- it overwrites files but keeps existing data.

.NOTES
    Run as the operator user (Aimz).  No elevation required for most steps;
    Docker Desktop must already be running for the image build step.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

$SCRIPT_DIR  = Split-Path -Parent $MyInvocation.MyCommand.Definition
$REPO_ROOT   = (Resolve-Path (Join-Path $SCRIPT_DIR "..")).Path

$DEST        = "C:\pinch-test-mc"
$DEST_BACKEND = "$DEST\backend"
$DEST_DATA    = "$DEST\data"

$SRC_BACKEND  = Join-Path $REPO_ROOT "backend"
$SRC_DATA     = Join-Path $REPO_ROOT "data"
$SRC_TRAY     = Join-Path $REPO_ROOT "tray"

Write-Host ""
Write-Host "=== Pinch Test Machine -- Standalone Assembler ==="
Write-Host "Repo root  : $REPO_ROOT"
Write-Host "Dest       : $DEST"
Write-Host ""

# ---------------------------------------------------------------------------
# Step 0: Create destination directories
# ---------------------------------------------------------------------------
Write-Host "[0/7] Creating destination directories ..."
@($DEST, $DEST_BACKEND, $DEST_DATA) | ForEach-Object {
    if (-not (Test-Path $_)) {
        New-Item -ItemType Directory -Path $_ -Force | Out-Null
        Write-Host "  Created: $_"
    } else {
        Write-Host "  Exists : $_"
    }
}

# ---------------------------------------------------------------------------
# Step 1: Copy backend source (app, alembic, pyproject, py32, bridge, config)
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[1/7] Copying backend source to $DEST_BACKEND ..."

$itemsToCopy = @(
    "app",
    "alembic.ini",
    "pyproject.toml",
    "py32",
    "plc_bridge.py"
)
foreach ($item in $itemsToCopy) {
    $src = Join-Path $SRC_BACKEND $item
    $dst = Join-Path $DEST_BACKEND $item
    if (Test-Path $src) {
        if ((Get-Item $src).PSIsContainer) {
            # Directory: use robocopy for speed + reliability
            # /XD __pycache__ /XF *.pyc: skip stale bytecode (embeds the old repo path in
            # tracebacks; the dest venv recompiles on first import anyway).
            robocopy $src $dst /E /NFL /NDL /NJH /NJS /nc /ns /np /MIR /XD __pycache__ /XF *.pyc 2>&1 | Out-Null
            Write-Host "  Copied dir  : $item"
        } else {
            Copy-Item $src $dst -Force
            Write-Host "  Copied file : $item"
        }
    } else {
        Write-Warning "  NOT FOUND (skip): $src"
    }
}

# config.yaml: copy if destination does not have one; never overwrite operator edits
$srcConfig = Join-Path $SRC_BACKEND "config.yaml"
$dstConfig = Join-Path $DEST_BACKEND "config.yaml"
if (-not (Test-Path $dstConfig)) {
    if (Test-Path $srcConfig) {
        Copy-Item $srcConfig $dstConfig -Force
        Write-Host "  Copied file : config.yaml (initial)"
    } elseif (Test-Path (Join-Path $SRC_BACKEND "config.example.yaml")) {
        Copy-Item (Join-Path $SRC_BACKEND "config.example.yaml") $dstConfig -Force
        Write-Host "  Copied file : config.yaml (from config.example.yaml -- review settings)"
    }
} else {
    Write-Host "  Kept existing: config.yaml (not overwritten)"
}

# ---------------------------------------------------------------------------
# Step 2: Copy data (pinch.db + waveforms) -- preserve existing operator data
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[2/7] Copying data (pinch.db + waveforms) to $DEST_DATA ..."
$srcDb = Join-Path $SRC_DATA "pinch.db"
$dstDb = Join-Path $DEST_DATA "pinch.db"
if (Test-Path $srcDb) {
    if (-not (Test-Path $dstDb)) {
        Copy-Item $srcDb $dstDb -Force
        Write-Host "  Copied: pinch.db"
    } else {
        Write-Host "  Kept existing: pinch.db (not overwritten)"
    }
}
$srcWave = Join-Path $SRC_DATA "waveforms"
$dstWave = Join-Path $DEST_DATA "waveforms"
if (Test-Path $srcWave) {
    robocopy $srcWave $dstWave /E /NFL /NDL /NJH /NJS /nc /ns /np 2>&1 | Out-Null
    Write-Host "  Synced: waveforms\"
}

# ---------------------------------------------------------------------------
# Step 3: Create fresh venv at destination and install package
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[3/7] Creating fresh venv at $DEST_BACKEND\.venv ..."

$pyCmd = Get-Command python -ErrorAction SilentlyContinue
$systemPy = if ($pyCmd) { $pyCmd.Source } else { $null }
if (-not $systemPy) {
    # Try common install locations
    $candidates = @(
        "C:\Python311\python.exe",
        "C:\Python312\python.exe",
        "C:\Python313\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe"
    )
    $systemPy = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $systemPy) {
    Write-Warning "[3/7] SKIPPED: Could not find a system Python. Install Python 3.11+ and re-run."
} else {
    Write-Host "  Using Python: $systemPy"
    $destVenvPy = "$DEST_BACKEND\.venv\Scripts\python.exe"
    if (-not (Test-Path $destVenvPy)) {
        Write-Host "  Creating venv ..."
        & $systemPy -m venv "$DEST_BACKEND\.venv"
    } else {
        Write-Host "  Venv already exists at destination."
    }

    Write-Host "  Upgrading pip ..."
    & $destVenvPy -m pip install --upgrade pip --quiet

    Write-Host "  Installing backend package (pip install -e .) ..."
    & $destVenvPy -m pip install -e "$DEST_BACKEND" --quiet

    Write-Host "  Running alembic upgrade head ..."
    Push-Location $DEST_BACKEND
    try {
        & $destVenvPy -m alembic upgrade head
    } finally {
        Pop-Location
    }
    Write-Host "  Venv ready."
}

# ---------------------------------------------------------------------------
# Step 4: Build frontend Docker image (requires Docker Desktop running)
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[4/7] Building frontend Docker image (pinch-frontend:latest) ..."
$dockerComposeSrc = Join-Path $REPO_ROOT "docker-compose.yml"
$dockerRunning = $false
try {
    docker info 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $dockerRunning = $true }
} catch {}

if (-not $dockerRunning) {
    Write-Warning "[4/7] SKIPPED: Docker Desktop is not running."
    Write-Warning "       Start Docker Desktop and run:"
    Write-Warning "       cd '$REPO_ROOT'"
    Write-Warning "       docker compose build frontend"
} elseif (-not (Test-Path $dockerComposeSrc)) {
    Write-Warning "[4/7] SKIPPED: docker-compose.yml not found at $dockerComposeSrc"
} else {
    Write-Host "  Running: docker compose build frontend ..."
    Push-Location $REPO_ROOT
    try {
        docker compose build frontend
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "docker compose build returned $LASTEXITCODE -- image may not be current."
        } else {
            Write-Host "  Image built: pinch-frontend:latest"
        }
    } finally {
        Pop-Location
    }
}

# Write standalone docker-compose.yml (image-only, no build: context)
Write-Host ""
Write-Host "  Writing standalone docker-compose.yml to $DEST ..."
$standalonCompose = @"
# Standalone docker-compose.yml -- generated by assemble-standalone.ps1
# No build: context; works after the git repo has been deleted.
# The pinch-frontend:latest image must already be present (built from repo before deletion).
#
#   Ensure container is up:   docker compose up -d frontend
#   View logs:                docker compose logs -f frontend
#
services:
  frontend:
    image: pinch-frontend:latest
    container_name: pinch-frontend
    ports:
      - "8080:80"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    restart: always
"@
Set-Content -Path "$DEST\docker-compose.yml" -Value $standalonCompose -Encoding UTF8
Write-Host "  Written: $DEST\docker-compose.yml"

# ---------------------------------------------------------------------------
# Step 5: Build pinch-tray.exe
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[5/7] Building pinch-tray.exe ..."
$repoVenvPy = "$SRC_BACKEND\.venv\Scripts\python.exe"
if (-not (Test-Path $repoVenvPy)) {
    Write-Warning "[5/7] SKIPPED: Repo venv not found at $repoVenvPy."
    Write-Warning "       Run  tray\build.bat  manually after setting up the repo venv."
} else {
    # Install tray requirements into repo venv first
    Write-Host "  Installing tray requirements into repo venv ..."
    & $repoVenvPy -m pip install -r "$SRC_TRAY\requirements.txt" --quiet

    # Run PyInstaller with distpath = C:\pinch-test-mc
    $workDir = "$SRC_TRAY\build_work"
    Write-Host "  Running PyInstaller ..."
    # Note: --specpath is not valid when passing a .spec file path directly.
    & $repoVenvPy -m PyInstaller `
        --noconfirm `
        --distpath $DEST `
        --workpath $workDir `
        "$SRC_TRAY\pinch_tray.spec"

    if ($LASTEXITCODE -ne 0) {
        Write-Warning "[5/7] PyInstaller failed (exit $LASTEXITCODE). See output above."
    } else {
        Write-Host "  Built: $DEST\pinch-tray.exe"
    }
}

# ---------------------------------------------------------------------------
# Step 6: Write pinch-tray.ini and support files
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[6/7] Writing config + support files to $DEST ..."

# pinch-tray.ini
$ini = @"
[pinch]
; Absolute path to the backend directory (contains app\, .venv\, py32\, config.yaml)
; Set PINCH_BACKEND_DIR env var or edit this file if you move the installation.
backend_dir  = $DEST_BACKEND

; Absolute path to the standalone docker-compose.yml
compose_file = $DEST\docker-compose.yml
"@
Set-Content -Path "$DEST\pinch-tray.ini" -Value $ini -Encoding UTF8
Write-Host "  Written: $DEST\pinch-tray.ini"

# Copy tray support scripts
foreach ($f in @("install_autostart.ps1", "uninstall_autostart.ps1", "README.md")) {
    $src = Join-Path $SRC_TRAY $f
    if (Test-Path $src) {
        Copy-Item $src "$DEST\$f" -Force
        Write-Host "  Copied : $f"
    } else {
        Write-Warning "  NOT FOUND: $src (skipping)"
    }
}

# ---------------------------------------------------------------------------
# Step 7: Summary
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== Assembly complete ==="
Write-Host ""
Write-Host "Contents of $DEST :"
Get-ChildItem $DEST | Format-Table Name, LastWriteTime -AutoSize
Write-Host ""
Write-Host "Next steps for the operator:"
Write-Host "  1. (If not done) Docker Desktop: Settings > General > 'Start Docker Desktop when you log in'"
Write-Host "  2. Run once to start the container:  docker compose -f $DEST\docker-compose.yml up -d frontend"
Write-Host "  3. Add tray to Windows Startup:      powershell -File $DEST\install_autostart.ps1"
Write-Host "  4. Start the tray now (no reboot):   $DEST\pinch-tray.exe"
Write-Host ""
Write-Host "External prerequisites (not bundled):"
Write-Host "  - Docker Desktop (installed, start-on-login enabled)"
Write-Host "  - KEYENCE KVComPlus DLL: C:\Program Files (x86)\KEYENCE\KVComPlusLB\bin\DataBuilder.dll"
Write-Host "  - Microsoft Edge (standard Windows install)"
Write-Host ""
Write-Host "Logs: $DEST_BACKEND\logs\tray.log  and  $DEST_BACKEND\logs\app.log"
