@echo off
chcp 65001 >nul
title 황금 용의 던전 - 게임 서버
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js가 아직 설치되어 있지 않아요. 설치 페이지를 열게요.
  echo  LTS 버전을 설치한 뒤 이 파일을 다시 더블클릭해 주세요.
  echo.
  start "" https://nodejs.org/ko/download
  pause
  exit /b
)
node server.js --open
pause
