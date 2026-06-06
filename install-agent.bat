@echo off
title Hotspot Agent Installer
color 0A

echo.
echo ==========================================
echo   HOTSPOT PC AGENT - INSTALLER
echo   Tanzania WiFi System
echo ==========================================
echo.

:: Check Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js haipo. Download kwanza:
    echo    https://nodejs.org/en/download
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js imepatikana
echo.

:: Install dependencies
echo [1/4] Inaweka dependencies...
call npm install axios
echo [OK] Dependencies zimewekwa
echo.

:: Create config file
echo [2/4] Inatengeneza config...
if not exist "agent-config.bat" (
    (
        echo @echo off
        echo SET SERVER_URL=https://YOUR-APP.onrender.com
        echo SET AGENT_KEY=AgentKey2024Secret
        echo SET ROUTER_IP=192.168.3.1
        echo SET ROUTER_PASS=NYWILA_YA_ROUTER_YAKO
        echo node agent.js
    ) > agent-config.bat
    echo [OK] Config file imetengenezwa
    echo.
    echo *** MUHIMU: Fungua agent-config.bat na badilisha:
    echo     1. SERVER_URL - URL yako ya Render
    echo     2. AGENT_KEY  - Key ile ile uliyoweka kwenye server  
    echo     3. ROUTER_PASS - Nywila ya router yako
    echo.
    pause
)

:: Create startup shortcut
echo [3/4] Inaweka auto-start...
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
copy "agent-config.bat" "%STARTUP%\hotspot-agent.bat" >nul
echo [OK] Auto-start imewekwa
echo.

:: Start agent
echo [4/4] Inaanza agent...
echo.
echo ==========================================
echo   AGENT INAANZA - Usifunge window hii
echo ==========================================
echo.
call agent-config.bat
