@echo off
setlocal
cd /d %~dp0
npm install
npm run dev
