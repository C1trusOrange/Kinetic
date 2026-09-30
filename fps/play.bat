@echo off
cd /d "%~dp0"
echo.
echo   KINETIC - starting local server at http://localhost:8000/
echo   (close this window to stop the game server)
echo.
start "" "http://localhost:8000/"
where python >nul 2>nul
if %errorlevel%==0 (
  python tools\serve.py 8000
) else (
  py tools\serve.py 8000
)
