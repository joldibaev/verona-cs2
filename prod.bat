@echo off
REM ==========================================================================
REM  Verona - PROD mode
REM  Builds and starts the production stack: admin (UI baked into the image)
REM  and postgres. The cs2 game server is under the "game" profile and stays
REM  idle until started from the admin panel; its image is (re)built here too.
REM
REM  Open the panel at  http://localhost:8080
REM ==========================================================================
setlocal
cd /d "%~dp0"

echo [prod] Checking the persistent CS2 volume ...
docker volume inspect verona-cs2-data >nul 2>&1
if errorlevel 1 (
    echo [prod] Creating persistent volume verona-cs2-data ...
    docker volume create verona-cs2-data >nul
    if errorlevel 1 goto :error
)

echo [prod] Building and starting admin + postgres ...
docker compose up -d --build admin postgres
if errorlevel 1 goto :error

echo [prod] Building the cs2 game-server image ...
docker compose --profile game build cs2
if errorlevel 1 goto :error

echo [prod] Creating the cs2 game-server container (started later from the panel) ...
docker compose --profile game create --no-recreate cs2
if errorlevel 1 goto :error

docker container inspect verona-cs2-server >nul 2>&1
if errorlevel 1 goto :error

echo [prod] Ensuring admin + postgres are running ...
docker compose up -d admin postgres
if errorlevel 1 goto :error

echo.
echo [prod] Done. Panel: http://localhost:8080
goto :eof

:error
echo.
echo [prod] Failed. See the output above.
exit /b 1
