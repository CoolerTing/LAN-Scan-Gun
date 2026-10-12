@echo off
setlocal
cd /d "%~dp0"
call npm ci
if errorlevel 1 goto failed
call npm test
if errorlevel 1 goto failed
call npm run dist
if errorlevel 1 goto failed
echo Installer generated in outputs\windows.
pause
exit /b 0
:failed
echo Build failed. Review the message above and README.md.
pause
exit /b 1
