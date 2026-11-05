@echo off
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
set "PET_VOICE_LABEL=1"
if not exist "node_modules\electron\dist\electron.exe" (
  echo [ERROR] electron.exe not found.
  echo Run "npm install" in this folder first.
  pause
  exit /b 1
)
if not exist "assets\audio\amiya.ogg" (
  echo [ERROR] assets\audio\amiya.ogg not found.
  echo See assets\README.md for how to prepare the voice pack.
  pause
  exit /b 1
)
if not exist "assets\audio\amiya.segments.json" (
  echo [ERROR] assets\audio\amiya.segments.json not found.
  echo Run this first:
  echo   python scripts\segment-voice.py assets\audio\amiya.ogg -o assets\audio\amiya.segments.json
  pause
  exit /b 1
)
echo Opening the voice labelling window...
echo Close this console window when you are done, or press Ctrl+C.
"node_modules\electron\dist\electron.exe" "%~dp0."
