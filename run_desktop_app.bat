@echo off
title DeepChart Windows Desktop Terminal
cd /d "%~dp0"
echo Terminating any active DeepChart instances to release file locks...
taskkill /F /IM deepchart-desktop.exe >nul 2>&1
timeout /t 1 /nobreak >nul

if not exist "%~dp0apps\desktop\node_modules" (
    echo [Setup] Installing desktop dependencies (npm install)...
    call npm --prefix "%~dp0apps\desktop" install
)

echo Starting DeepChart Windows Desktop Terminal (Tauri 2)...
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\run_desktop_app.ps1"
pause
