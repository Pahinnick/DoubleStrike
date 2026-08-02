@echo off
setlocal

rem Runs the project's packaged Electron build (tsc -b && vite build && electron-builder)
rem so you can build the installer/exe yourself if Claude Code isn't available. Always
rem builds from this script's own folder, regardless of where it's launched from
rem (double-click, shortcut, etc).
cd /d "%~dp0"

echo ============================================
echo  MTG Deck Builder - Build
echo  Folder: %cd%
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found on PATH. Install Node and try again.
    goto :fail
)

for /f "tokens=*" %%v in ('node --version') do echo Using Node %%v
echo.

if not exist "node_modules" (
    echo node_modules not found - running "npm install" first...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        goto :fail
    )
    echo.
)

echo Running "npm run electron:build" (tsc -b, vite build, then electron-builder)...
echo.
call npm run electron:build
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed - see output above.
    goto :fail
)

echo.
echo ============================================
echo  Build succeeded. Output is in .\release
echo ============================================
goto :done

:fail
echo.
echo ============================================
echo  Build FAILED.
echo ============================================
pause
exit /b 1

:done
pause
exit /b 0
