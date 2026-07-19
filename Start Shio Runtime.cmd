@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\ShioLauncher.ps1" %*
set "SHIO_EXIT=%ERRORLEVEL%"
if not "%SHIO_EXIT%"=="0" (
  echo.
  echo Shio Runtime launcher failed. See the launcher log for details.
  pause
)
exit /b %SHIO_EXIT%
