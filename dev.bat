@echo off
REM ==========================================================================
REM  Verona - DEV mode
REM  Backend (admin) runs via `dotnet watch` in Docker  -> C# hot reload
REM  Postgres runs in Docker                            -> exposed on :5432
REM  Frontend (Vite) runs locally                       -> instant HMR
REM
REM  Open the panel at  http://localhost:5173  (NOT :8080).
REM  Vite proxies /api and /hub to the admin container on :8080.
REM  The game server is NOT started here; launch it from the panel as usual
REM  (build its image once with prod.bat if it doesn't exist yet).
REM ==========================================================================
setlocal
cd /d "%~dp0"

echo [dev] Starting postgres + admin (dotnet watch) ...
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres admin
if errorlevel 1 goto :error

echo [dev] Installing UI dependencies if needed ...
cd admin\ui
if not exist node_modules (
    call npm install
    if errorlevel 1 goto :error
)

echo [dev] Starting Vite dev server (press q + Enter to quit cleanly) ...
call npm run dev

echo.
echo [dev] Stopping dev containers ...
cd /d "%~dp0"
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
goto :eof

:error
echo.
echo [dev] Failed. See the output above.
exit /b 1
