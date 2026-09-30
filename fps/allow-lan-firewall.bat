@echo off
rem Adds an inbound Windows Firewall rule so friends on your local network can reach the KINETIC LAN
rem server started by host-lan.bat: TCP port 8000, Private networks only. Run it once if friends cannot
rem connect. Windows asks for administrator rights (UAC). Undo with:
rem   netsh advfirewall firewall delete rule name="KINETIC LAN (TCP 8000)"
title KINETIC - allow LAN play through the firewall
fltmc >nul 2>&1
if not errorlevel 1 goto admin
if "%~1"=="--elevated" goto noadmin
echo   Asking Windows for administrator rights...
rem Run this file again as administrator. The path goes into a PowerShell single-quoted string, where an
rem apostrophe (a folder like "Sam's PC") must be doubled.
set "SELF=%~f0"
set "SELF=%SELF:'=''%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Start-Process -FilePath '%SELF%' -ArgumentList '--elevated' -Verb RunAs -ErrorAction Stop } catch { exit 1 }"
if errorlevel 1 goto noadmin
exit /b 0

:noadmin
echo   Could not get administrator rights, so nothing was changed.
pause
exit /b 1

:admin
echo.
echo   Adding the firewall rule "KINETIC LAN (TCP 8000)" for Private networks...
netsh advfirewall firewall delete rule name="KINETIC LAN (TCP 8000)" >nul 2>&1
netsh advfirewall firewall add rule name="KINETIC LAN (TCP 8000)" dir=in action=allow protocol=TCP localport=8000 profile=private
if errorlevel 1 (
  echo   Windows refused to add the rule.
) else (
  echo   Done: devices on a Private network can now reach this PC on port 8000.
)
echo.
echo   Good to know:
echo   - Windows still blocks friends while your network is set to Public. On a network you
echo     trust (home), switch it to Private: Settings ^> Network ^& internet ^> Wi-Fi (or Ethernet)
echo     ^> your network ^> Network profile type ^> Private network.
echo   - If you once clicked Cancel when Windows asked about Python, Windows added rules that
echo     BLOCK Python, and those win over this rule. Remove them in Windows Defender Firewall ^>
echo     Advanced settings ^> Inbound Rules (entries named Python with a red block icon).
echo   - Guest / hotel / school Wi-Fi often stops devices from reaching each other at all.
echo.
pause
