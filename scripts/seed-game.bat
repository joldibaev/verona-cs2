@echo off
REM ==========================================================================
REM  Verona - seed the CS2 volume from a local Windows install (one-off tool)
REM
REM  Copies the cross-platform game content (~55 GB of VPKs) from an existing
REM  Windows CS2 install straight into the verona-cs2-data volume, then runs
REM  SteamCMD `validate` so only the missing Linux server binaries download,
REM  instead of pulling the full ~64 GB over the network.
REM
REM  Runs in the FOREGROUND: you see copy progress and SteamCMD output, and
REM  Ctrl+C cancels (the container stops and leaves the volume to be re-seeded).
REM  Run it once before starting the server; the panel then starts it normally.
REM
REM  Usage:
REM     scripts\seed-game.bat
REM     scripts\seed-game.bat "D:\SteamLibrary\steamapps\common\Counter-Strike Global Offensive"
REM ==========================================================================
setlocal
cd /d "%~dp0.."

REM --- Source install (first arg overrides, else default Steam path) ---------
set "LOCAL_CS2=%~1"
if "%LOCAL_CS2%"=="" set "LOCAL_CS2=C:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Global Offensive"

if not exist "%LOCAL_CS2%\game\csgo" (
    echo [seed] Local CS2 install not found at:
    echo [seed]     "%LOCAL_CS2%"
    echo [seed] Pass the correct path as the first argument, e.g.:
    echo [seed]     scripts\seed-game.bat "D:\SteamLibrary\steamapps\common\Counter-Strike Global Offensive"
    goto :error
)
echo [seed] Source install: %LOCAL_CS2%

REM --- Ensure the persistent volume exists (external in compose) --------------
REM Create it BEFORE any compose command: the cs2 service declares this volume
REM as external, so `compose create/up` refuses to run while it is missing.
docker volume inspect verona-cs2-data >nul 2>&1
if errorlevel 1 (
    echo [seed] Creating persistent volume verona-cs2-data ...
    docker volume create verona-cs2-data >nul
    if errorlevel 1 goto :error
)

REM --- The server image provides SteamCMD, gosu and the right file ownership --
REM `compose build` only builds the image (no container, no volume dependency).
docker image inspect verona-cs2-server:latest >nul 2>&1
if errorlevel 1 (
    echo [seed] Server image is missing. Building it first ...
    docker compose --profile game build cs2
    if errorlevel 1 goto :error
)

echo.
echo [seed] Starting. Copy progress and SteamCMD output appear below.
echo [seed] Press Ctrl+C to cancel.
echo.

REM Everything runs in one foreground container (-it so Ctrl+C reaches it).
REM The inline script: guard against clobbering a populated volume, wipe any
REM partial content, copy with a live size counter, drop the Windows-only
REM win64 binaries, fix ownership, then validate (downloads only the delta).
REM Kept on ONE line: ^ continuation does not work inside a quoted string.
docker run --rm -it ^
  -v verona-cs2-data:/server ^
  -v "%LOCAL_CS2%:/src:ro" ^
  --entrypoint bash ^
  verona-cs2-server:latest ^
  -c "set -e; if [ ! -d /src/game/csgo ]; then echo '[seed] ERROR: /src/game/csgo not found - is the install mounted at /src?'; exit 1; fi; if [ -d /server/game/csgo ] && [ ${SEED_FORCE:-0} != 1 ]; then echo '[seed] Volume already has game content. To re-seed run: docker volume rm verona-cs2-data'; exit 0; fi; echo '[seed] Clearing any partial content...'; rm -rf /server/game; mkdir -p /server/game; B=$(du -sb /src/game | cut -f1); H=$(numfmt --to=iec $B); echo '[seed] Copying '$H' of game content. Press Ctrl+C to cancel.'; cp -a /src/game/. /server/game/ & CP=$!; while kill -0 $CP 2>/dev/null; do N=$(du -sb /server/game 2>/dev/null | cut -f1); N=${N:-0}; echo -ne '\r[seed]   copied '$(numfmt --to=iec $N)' / '$H'          '; sleep 2; done; wait $CP; echo; echo '[seed] Removing Windows-only binaries (win64)...'; rm -rf /server/game/bin/win64; echo '[seed] Fixing ownership for steam...'; chown -R steam:steam /server; echo '[seed] Validating with SteamCMD - only the Linux delta downloads...'; exec gosu steam /opt/steamcmd/steamcmd.sh +force_install_dir /server +login anonymous +app_update 730 validate +quit"
if errorlevel 1 goto :error

echo.
echo [seed] Done. The volume is populated - start the server from the panel.
echo.
pause
goto :eof

:error
echo.
echo [seed] Failed or cancelled. See the output above.
echo.
pause
exit /b 1
