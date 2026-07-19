@echo off
setlocal
set "SHIO_LAUNCHER=%~dp0ShioLauncher.ps1"
if not exist "%SHIO_LAUNCHER%" set "SHIO_LAUNCHER=%~dp0launcher\ShioLauncher.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SHIO_LAUNCHER%" %*
set "SHIO_EXIT=%ERRORLEVEL%"
if not "%SHIO_EXIT%"=="0" (
  echo.
  echo Shio Runtime launcher failed. See the launcher log for details.
  pause
)
exit /b %SHIO_EXIT%
