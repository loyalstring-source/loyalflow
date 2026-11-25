@echo off
REM Start LoyalFlow on Windows with demo data. Needs Node 22.18 or newer: https://nodejs.org
cd /d "%~dp0\.."
where node >nul 2>nul || (echo Install Node.js 22 LTS from https://nodejs.org first. & pause & exit /b 1)
if not exist node_modules (npm install --no-audit --no-fund)
if "%LOYALFLOW_DEMO%"=="" set LOYALFLOW_DEMO=1
if "%PORT%"=="" set PORT=3000
echo Starting LoyalFlow on http://localhost:%PORT% (demo data: %LOYALFLOW_DEMO%)
echo Sign in as sridhar.ngowda@loyalstring.com / Welcome@LoyalFlow1
node --no-warnings=ExperimentalWarning src\server.ts
pause
