#Requires -Version 5.1
<#
.SYNOPSIS
    Installs pinch-tray.exe as a Windows auto-start item (per-user, registry).

.DESCRIPTION
    Writes the HKCU Run key so pinch-tray.exe launches on every login.
    Also removes any legacy start-pinch*.bat / start-pinch*.lnk shortcuts
    from the user Startup folder to avoid duplicate launches.

.NOTES
    Run as the operator user (Aimz). No elevation required.
    Build the exe first with:  tray\build.bat
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$EXE_PATH = "C:\pinch-test-mc\pinch-tray.exe"
$REG_PATH  = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$REG_NAME  = "PinchTestMachine"

# Guard: exe must exist
if (-not (Test-Path $EXE_PATH)) {
    Write-Error "EXE not found: $EXE_PATH`nRun  tray\build.bat  (or assemble-standalone.ps1) first."
    exit 1
}

# Write registry Run key
Set-ItemProperty -Path $REG_PATH -Name $REG_NAME -Value $EXE_PATH -Type String
Write-Host "Registry Run key set:"
Write-Host "  HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
Write-Host "  $REG_NAME = $EXE_PATH"

# Remove legacy Startup folder shortcuts / batch files
$appdata = $env:APPDATA
if ($appdata) {
    $startupDir = Join-Path $appdata "Microsoft\Windows\Start Menu\Programs\Startup"
    if (Test-Path $startupDir) {
        $removed = 0
        $items = Get-ChildItem -Path $startupDir -File -ErrorAction SilentlyContinue
        foreach ($item in $items) {
            $ext  = $item.Extension.ToLower()
            $name = $item.Name.ToLower()
            $isLegacy = ($ext -eq ".bat" -or $ext -eq ".lnk") -and (
                $name -like "start-pinch*" -or $name -eq "pinch test machine.lnk"
            )
            if ($isLegacy) {
                Remove-Item $item.FullName -Force
                Write-Host "Removed legacy shortcut: $($item.FullName)"
                $removed++
            }
        }
        if ($removed -eq 0) {
            Write-Host "No legacy start-pinch shortcuts found in Startup folder."
        }
    }
}

Write-Host ""
Write-Host "Auto-start installed. pinch-tray.exe will launch on next login."
Write-Host "To remove auto-start, run:  powershell -File uninstall_autostart.ps1"
