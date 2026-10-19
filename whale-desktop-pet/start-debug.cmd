@echo off
rem Same as start.cmd but keeps a log in _run.log (troubleshooting).
setlocal
set "ELECTRON_RUN_AS_NODE="
for %%i in ("%~dp0.") do set "APP=%%~fi"
set "EXE=%~dp0..\.tools\electron44\electron.exe"
set "DATA=%APPDATA%\WhaleDesktopPet"
set "PROFILE=%LOCALAPPDATA%\WhaleDesktopPet\chromium"
if not exist "%DATA%" mkdir "%DATA%" >nul 2>&1
if not exist "%PROFILE%" mkdir "%PROFILE%" >nul 2>&1
set "WHALE_PET_DATA=%DATA%"
"%EXE%" "%APP%" --no-sandbox --user-data-dir="%PROFILE%" --enable-logging > "%~dp0_run.log" 2>&1