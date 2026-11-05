@echo off
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
echo ==========================================
echo  deskpet - DEBUG MODE
echo  Logs are printed in this window.
echo  Close this window to stop the pet.
echo ==========================================
echo.
if not exist "node_modules\electron\dist\electron.exe" (
  echo [ERROR] electron.exe not found.
  echo Run "npm install" in this folder first.
  pause
  exit /b 1
)
"node_modules\electron\dist\electron.exe" "%~dp0." --dev
echo.
echo [deskpet exited, code %ERRORLEVEL%]
pause
