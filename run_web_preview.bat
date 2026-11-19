@echo off
title DeepChart Web Preview (Port 1420)
cd /d "%~dp0"

if not exist "%~dp0apps\desktop\node_modules" (
    echo [Setup] Installing desktop dependencies (npm install)...
    call npm --prefix "%~dp0apps\desktop" install
)

echo Starting DeepChart Web Preview...
call npm --prefix "%~dp0apps\desktop" run dev
pause
