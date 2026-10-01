@echo off
cd /d "%~dp0"
echo.
echo   KINETIC - starting local server at http://localhost:8000/
echo   (close this window to stop the game server)
echo.
where python >nul 2>nul
if %errorlevel%==0 (
  python tools\serve.py 8000 --open
) else (
  py tools\serve.py 8000 --open
)
if errorlevel 1 pause
