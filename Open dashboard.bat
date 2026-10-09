@echo off
rem Opens the dashboard in the browser without starting a server here, for when it runs on another device.
rem The address is DASHBOARD_URL in .env (for example http://192.168.1.20:8000); without it, this machine's.
cd /d "%~dp0"
set "URL=http://localhost:8000"
if exist .env for /f "usebackq tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="DASHBOARD_URL" if not "%%b"=="" set "URL=%%b"
start "" "%URL%"
