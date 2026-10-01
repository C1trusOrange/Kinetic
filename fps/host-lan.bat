@echo off
cd /d "%~dp0"
title KINETIC - LAN host
echo.
echo   KINETIC - host a game for your local network
echo   ============================================
echo   Friends on the same Wi-Fi / network open the "Friends:" address shown below
echo   in Chrome or Edge, then join with your room code.
echo   Keep this window open while you play: closing it ends the game for everyone.
echo.
echo   The first time, Windows asks whether Python may use networks:
echo   tick "Private networks" and click "Allow access".
echo   If friends still cannot connect, run allow-lan-firewall.bat once.
echo.
where python >nul 2>nul
if %errorlevel%==0 (
  python tools\serve.py 8000 --lan --open
) else (
  py tools\serve.py 8000 --lan --open
)
if errorlevel 1 pause
