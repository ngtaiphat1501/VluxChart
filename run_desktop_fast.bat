@echo off
title DeepChart Windows Desktop Terminal
cd /d "%~dp0"
echo Terminating any active DeepChart instances...
taskkill /F /IM deepchart-desktop.exe >nul 2>&1
timeout /t 1 /nobreak >nul
echo Starting DeepChart Windows Desktop Terminal...
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\run_desktop_app.ps1"
