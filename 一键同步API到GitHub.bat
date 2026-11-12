@echo off
chcp 65001 >nul
title 一键同步 API 密文到 GitHub
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync_api.ps1"

echo.
echo 按任意键退出...
pause >nul
