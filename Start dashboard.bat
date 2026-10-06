@echo off
cd /d "%~dp0"
start "" cmd /c "timeout /t 4 >nul & start http://localhost:8000"
".venv\Scripts\python.exe" backend\app.py
pause