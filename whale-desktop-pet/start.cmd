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

if not exist "%DATA%" mkdir "%DATA%" >nul 2>&1
if not exist "%PROFILE%" mkdir "%PROFILE%" >nul 2>&1

set "WHALE_PET_DATA=%DATA%"
start "" "%EXE%" "%APP%" --no-sandbox --user-data-dir="%PROFILE%"

rem If the previous run was killed hard, Chromium may leave a dirty profile
rem that makes the next start crash instantly. Detect and retry with a clean one.
timeout /t 5 /nobreak >nul
tasklist /fi "imagename eq electron.exe" 2>nul | find /i "electron.exe" >nul
if errorlevel 1 (
  rmdir /s /q "%PROFILE%" >nul 2>&1
  mkdir "%PROFILE%" >nul 2>&1
  start "" "%EXE%" "%APP%" --no-sandbox --user-data-dir="%PROFILE%"
)
exit /b 0