@echo off
rem Opens the dashboard in its own window. It connects to DASHBOARD_URL in .env, or this machine; with no server
rem running here, it starts one until the window closes.
cd /d "%~dp0"
start "" ".venv\Scripts\pythonw.exe" desktop\main.py %*
