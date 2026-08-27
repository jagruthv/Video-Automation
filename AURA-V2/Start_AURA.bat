@echo off
echo Starting AURA V2 Engine...
cd /d "d:\Automation\AURA-V2" 

echo [SYSTEM] Hunting and destroying zombie instances on ports 3000, 3001, 8001...
FOR /F "tokens=5" %%a IN ('netstat -a -n -o ^| findstr ":3000 "') DO taskkill /F /PID %%a 2>NUL
FOR /F "tokens=5" %%a IN ('netstat -a -n -o ^| findstr ":3001 "') DO taskkill /F /PID %%a 2>NUL
FOR /F "tokens=5" %%a IN ('netstat -a -n -o ^| findstr ":8001 "') DO taskkill /F /PID %%a 2>NUL
echo [SYSTEM] Cleanup complete.

echo Booting Backend Telemetry Server...
start "AURA Backend" cmd /c "node src/server.js"

echo Booting Frontend Mission Console...
cd dashboard
start "AURA Dashboard" cmd /c "npm run dev"
cd /d "d:\Automation\AURA-V2"

echo Booting AURA Remix Engine API...
start "AURA Remix Engine" cmd /c "cd /d D:\Automation\AURA-V3 && python api.py"

echo Waiting 5 seconds for engines to ignite...
timeout /t 5 /nobreak > NUL

start http://localhost:3000
echo All systems running. AURA-V2 (port 3001), Dashboard (port 3000), AURA-V3 API (port 8001).
pause
