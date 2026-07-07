#Requires -Version 5.1
<#
.SYNOPSIS
    Removes the Pinch Test Machine tray app from Windows auto-start (registry).

.DESCRIPTION
    Deletes the HKCU Run key that was set by install_autostart.ps1.
    pinch-tray.exe will no longer launch automatically on login.

.NOTES
    Run as the operator user (Aimz). No elevation required.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$REG_PATH = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$REG_NAME = "PinchTestMachine"

$existing = Get-ItemProperty -Path $REG_PATH -Name $REG_NAME -ErrorAction SilentlyContinue
if ($null -ne $existing) {
    Remove-ItemProperty -Path $REG_PATH -Name $REG_NAME -Force
    Write-Host "Removed auto-start registry key: $REG_NAME"
    Write-Host "pinch-tray.exe will NOT launch automatically on next login."
} else {
    Write-Host "Auto-start key '$REG_NAME' not found -- nothing to remove."
}

Write-Host ""
Write-Host "To re-enable auto-start, run:  powershell -File install_autostart.ps1"
