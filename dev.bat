@echo off
setlocal
title Analytics Dashboard - One Click Development
color 0A

set "ROOT_DIR=%~dp0"
set "BACKEND_DIR=%ROOT_DIR%backend"
set "FRONTEND_DIR=%ROOT_DIR%frontend"
set "PYTHON=%BACKEND_DIR%\venv\Scripts\python.exe"
set "UVICORN=%BACKEND_DIR%\venv\Scripts\uvicorn.exe"
set "ALEMBIC=%BACKEND_DIR%\venv\Scripts\alembic.exe"

cd /d "%ROOT_DIR%"
echo =======================================================
echo    ANALYTICS DASHBOARD - ONE-CLICK DEV LAUNCHER
echo =======================================================
echo.

if not exist "%PYTHON%" (
  echo [ERROR] Python virtual environment not found.
  echo         Run: npm run install:backend
  pause
  exit /b 1
)
if not exist "%FRONTEND_DIR%\node_modules" (
  echo [ERROR] Frontend dependencies not found.
  echo         Run: npm run install:frontend
  pause
  exit /b 1
)

rem If backend\.env is absent, use safe single-machine SQLite defaults.
rem Existing backend\.env values are left untouched and take precedence.
if exist "%BACKEND_DIR%\.env" goto configured_environment
echo [INFO] backend\.env not found; using native SQLite development defaults.
set "NODE_ENV=development"
set "DATABASE_URL=sqlite+aiosqlite:///./analytics.db"
set "JWT_SECRET=local-development-secret-at-least-32-characters"
set "PASSWORD_PEPPER=local-development-pepper-at-least-16"
set "CLIENT_ORIGIN=http://localhost:5173"
set "CORS_ORIGINS=http://localhost:5173"
set "TRUSTED_HOSTS=localhost,127.0.0.1"
set "TRUST_PROXY_HEADERS=false"
set "FORCE_HTTPS=false"
set "UPLOAD_PATH=./uploads"
set "REDIS_URL="
set "RATE_LIMIT_STORAGE_URL="
set "METRICS_TOKEN=local-metrics-token-at-least-24-characters"

:configured_environment
echo [1/5] Applying database migrations...
pushd "%BACKEND_DIR%"
"%ALEMBIC%" -c alembic.ini upgrade head
if errorlevel 1 (
  popd
  echo [ERROR] Database migration failed. Check backend\.env and the database service.
  pause
  exit /b 1
)
popd

echo [2/5] Starting FastAPI backend on http://localhost:5000...
start "Analytics Dashboard - Backend API" /D "%BACKEND_DIR%" cmd /k ""%UVICORN%" app.main:app --port 5000 --reload"

echo [3/5] Starting durable analytics worker...
start "Analytics Dashboard - Analytics Worker" /D "%BACKEND_DIR%" cmd /k ""%PYTHON%" job_worker.py"

echo [4/5] Starting storage/job maintenance worker...
start "Analytics Dashboard - Maintenance" /D "%BACKEND_DIR%" cmd /k ""%PYTHON%" maintenance.py --delete-orphans"

echo [5/5] Starting Vite frontend on http://localhost:5173...
start "Analytics Dashboard - Frontend" /D "%FRONTEND_DIR%" cmd /k "npm run dev"

echo.
echo Services are starting in separate windows.
echo API docs: http://localhost:5000/docs
echo Readiness: http://localhost:5000/health/ready
echo Close the four service windows to stop development.
timeout /t 4 /nobreak >nul
start "" http://localhost:5173
exit /b 0
