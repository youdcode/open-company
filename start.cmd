@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 20 or newer is required: https://nodejs.org & exit /b 1)
node bin\start.mjs %*
