@echo off
title AgriTrace ColdChain - Local Server
echo ===================================================
echo   AGRI TRACEABILITY - COLDCHAIN (CHAY LOCAL)
echo ===================================================
echo Dang khoi dong Backend va Frontend tai http://localhost:3000...
echo.
cd /d "%~dp0backend"
node --env-file=../.env src/server.js
pause
