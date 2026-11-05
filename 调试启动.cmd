@echo off
chcp 65001 >nul
title 桌宠 - 调试模式
cd /d "%~dp0"

rem 清掉可能被继承的环境变量，否则 Electron 会退化成纯 Node
set ELECTRON_RUN_AS_NODE=

echo 正在启动桌宠（调试模式，日志显示在本窗口）...
echo.

"%~dp0node_modules\electron\dist\electron.exe" "%~dp0." --dev

echo.
echo 桌宠已退出，退出码 %ERRORLEVEL%
pause
