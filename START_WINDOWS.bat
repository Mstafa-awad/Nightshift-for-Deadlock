@echo off
cd /d "%~dp0"
where py >nul 2>&1
if %errorlevel%==0 (
    start "Nightshift Local Server" /MIN cmd /c "py -3 -m http.server 8765"
) else (
    start "Nightshift Local Server" /MIN cmd /c "python -m http.server 8765"
)
timeout /t 2 /nobreak >nul
start "" "http://localhost:8765"
