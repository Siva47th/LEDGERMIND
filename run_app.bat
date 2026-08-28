@echo off
title LedgerMind - Small Business Financial Advisor
echo ===================================================
echo   LedgerMind AI Financial Advisor - Starting Up...
echo ===================================================
echo.

:: Launch Backend Server in new terminal
echo [1/2] Launching Python Flask Backend Server (Port 5000)...
start "LedgerMind Backend API" cmd /k "cd /d %~dp0backend && python app.py"

:: Launch Frontend Dev Server in new terminal
echo [2/2] Launching Vite React Frontend (Port 5173)...
start "LedgerMind Frontend UI" cmd /k "cd /d %~dp0frontend && npm run dev"

:: Wait 3 seconds then open browser automatically
echo.
echo Launching LedgerMind Portal in browser at http://localhost:5173 ...
timeout /t 3 /nobreak >nul
start http://localhost:5173

echo.
echo ===================================================
echo   LedgerMind is now active and running live!
echo ===================================================
