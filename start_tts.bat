@echo off
chcp 65001 >nul
title 星彩 AI 语音服务 (Edge-TTS)
echo ====================================================
echo        正在启动 星彩 AI 语音服务 (Edge-TTS)...
echo        服务地址: http://127.0.0.1:8000
echo ====================================================
echo.
python tts_server.py
pause
