@echo off
chcp 65001 >nul 2>&1
echo ============================================================
echo    SALES ^& INVENTORY MANAGEMENT SYSTEM
echo    SYSTÈME DE GESTION DES VENTES
echo    نظام إدارة المبيعات ونقاط البيع
echo ============================================================
echo.
echo  [1] LOCAL MODE  (Same WiFi only - FAST, STABLE)
echo      Phones must be on the same WiFi as this computer
echo.
echo  [2] PUBLIC MODE (Any phone, anywhere - Internet)
echo      Phones can be on 4G/5G or different WiFi
echo.
echo ============================================================
echo.

set /p choice="Choose mode (1 or 2), press Enter for 1: "

if "%choice%"=="2" goto public

:local
echo.
echo Starting in LOCAL mode...
echo.
call npm install --production --silent
echo.
echo ============================================================
echo  Server running!
echo.
echo  On this computer:
echo    Admin:   http://localhost:3001/admin/
echo    POS:     http://localhost:3001/pos/
echo.
echo  Phones on same WiFi: use this computer's local IP
echo  (see README.txt for help finding your IP)
echo ============================================================
echo.
node src/index.js
goto end

:public
echo.
echo Starting in PUBLIC mode (with internet tunnel)...
echo.
call npm install --production --silent
echo.
echo ============================================================
echo  Starting server and creating public tunnel...
echo  (this may take 10-30 seconds)
echo ============================================================
echo.
node tunnel.js

:end
pause
