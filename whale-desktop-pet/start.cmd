@echo off
rem Whale desktop pet launcher - double click to bring her to the desktop.
setlocal
set "ELECTRON_RUN_AS_NODE="
for %%i in ("%~dp0.") do set "APP=%%~fi"
set "EXE=%~dp0..\.tools\electron44\electron.exe"
set "DATA=%APPDATA%\WhaleDesktopPet"
set "PROFILE=%LOCALAPPDATA%\WhaleDesktopPet\chromium"

if not exist "%EXE%" (
  echo [ERROR] Electron runtime not found:
  echo         %EXE%
  echo Make sure .tools\electron44 exists next to this folder.
  pause
  exit /b 1
)

rem Electron needs its profile dir to exist before start.
if not exist "%DATA%" mkdir "%DATA%" >nul 2>&1
if not exist "%PROFILE%" mkdir "%PROFILE%" >nul 2>&1

set "WHALE_PET_DATA=%DATA%"
start "" "%EXE%" "%APP%" --no-sandbox --user-data-dir="%PROFILE%"
exit /b 0