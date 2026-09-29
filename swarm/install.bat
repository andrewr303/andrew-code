@echo off
REM fusion\install.bat — foolproof Windows launcher.
REM Runs install.sh under GIT BASH (not WSL) so your Windows CLIs, codex, python,
REM and jq are visible. Use this from PowerShell or cmd:  install.bat  [args]
setlocal

set "GITBASH="
if exist "%ProgramFiles%\Git\bin\bash.exe" set "GITBASH=%ProgramFiles%\Git\bin\bash.exe"
if not defined GITBASH if exist "%ProgramFiles%\Git\usr\bin\bash.exe" set "GITBASH=%ProgramFiles%\Git\usr\bin\bash.exe"
if not defined GITBASH if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" set "GITBASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not defined GITBASH (
  echo Git Bash not found. Install Git for Windows: https://git-scm.com/download/win
  echo Fusion's scripts and Python engine require Git Bash at runtime.
  exit /b 1
)

REM forward-slash this script's dir so Git Bash resolves it correctly
set "HERE=%~dp0"
set "HERE=%HERE:\=/%"

"%GITBASH%" "%HERE%install.sh" %*
exit /b %ERRORLEVEL%
