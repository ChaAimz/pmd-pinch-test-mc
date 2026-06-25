@echo off
REM Stop all Pinch Test Machine processes (backend, frontend, Edge kiosk).
REM Closes the named cmd windows started by start-pinch.bat and the Edge kiosk.
echo Stopping pinch-backend, pinch-frontend, and Edge kiosk ...

REM Kill the named cmd windows
taskkill /F /FI "WindowTitle eq pinch-backend*" /T >nul 2>&1
taskkill /F /FI "WindowTitle eq pinch-frontend*" /T >nul 2>&1

REM Kill the 32-bit PLC bridge explicitly.  A hard kill of the backend window
REM skips the graceful shutdown, so the bridge can survive and keep the KV-3000
REM USB port open -> next launch fails with DBConnectA rc=4.  Kill it by name.
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*plc_bridge.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

REM Close the Edge kiosk (match on the pinch-mc profile path set by start-pinch.bat)
taskkill /F /FI "CommandLine like *pinch-mc*" /IM msedge.exe >nul 2>&1

echo Done.
