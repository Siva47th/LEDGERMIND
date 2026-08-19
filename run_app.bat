@echo off
title FinSense - Small Business Financial Advisor
echo ===================================================
echo   FinSense AI Financial Advisor - Starting Up...
echo ===================================================
echo.

:: Launch Backend Server in new terminal
echo [1/2] Launching Python Flask Backend Server (Port 5000)...
start "FinSense Backend API" cmd /k "cd /d %~dp0backend && python app.py"

:: Launch Frontend Dev Server in new terminal
echo [2/2] Launching Vite React Frontend (Port 5173)...
start "FinSense Frontend UI" cmd /k "cd /d %~dp0frontend && npm run dev"

:: Wait 3 seconds then open browser automatically
echo.
echo Launching FinSense Portal in browser at http://localhost:5173 ...
timeout /t 3 /nobreak >nul
start http://localhost:5173

echo.
echo ===================================================
echo   FinSense is now active and running live!
echo ===================================================
