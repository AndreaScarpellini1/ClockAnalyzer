@echo off
setlocal
set PORT=8000

rem Change to the folder this script is in
pushd "%~dp0"

rem Prefer the Python launcher "py" on Windows; fall back to "python"
where py >nul 2>nul
if %errorlevel%==0 (
  start "Pendolum Analyzer Server" /min py -m http.server %PORT%
) else (
  start "Pendolum Analyzer Server" /min python -m http.server %PORT%
)

rem Give the server a moment to start
ping 127.0.0.1 -n 2 >nul

start "" "http://localhost:%PORT%/index.html"
popd
exit /b 0
