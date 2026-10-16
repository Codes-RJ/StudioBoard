# Windows Setup: Docker and No-Docker Paths

This guide provides two supported development paths for the Analytics Dashboard. Choose one path; do not run both against the same upload directory and database at the same time.

## 1. Choose a runtime path

| Path | Best for | Database and cache | Notes |
| --- | --- | --- | --- |
| Docker Desktop | Full-stack testing and production-like local work | MySQL + Redis in containers | Recommended when the machine and licence allow Docker Desktop. |
| Native SQLite | Learning, UI work, and local single-user development | One SQLite file; Redis disabled | Free, no Docker or administrator rights after Python/Node are installed. Not a production topology. |

Docker Desktop is free for personal use, education, non-commercial open source, and qualifying small businesses. Confirm that the licence applies to your organization before installing it. See [Docker's Personal plan](https://www.docker.com/products/personal/) and [official Windows installation requirements](https://docs.docker.com/desktop/setup/install/windows-install/).

## 2. Docker Desktop on Windows

### 2.1 Check prerequisites

Open PowerShell and run:

```powershell
wsl --version
```

Docker Desktop's WSL 2 backend needs a supported 64-bit Windows installation, WSL 2, hardware virtualization enabled in BIOS/UEFI, and sufficient memory. If the command is unavailable or WSL is out of date, open **PowerShell as Administrator** and run:

```powershell
wsl --install
wsl --update
```

Restart Windows if requested.

### 2.2 Install and verify Docker

1. Download Docker Desktop from Docker's official Windows installation page.
2. Run the installer and select the recommended **per-user installation** with the **WSL 2 backend**.
3. Start Docker Desktop and wait until it reports that the engine is running.
4. Close and reopen PowerShell, then verify the CLI:

```powershell
docker version
docker compose version
```

Both commands must report versions. If `docker` is not recognized, Docker Desktop is not started or its CLI directory is not on the current shell's `PATH`.

### 2.3 Configure this repository

From the repository root, create a `.env` file from `.env.example` and supply local-only values. Never commit this file.

```dotenv
MYSQL_ROOT_PASSWORD=local-root-password-change-me
MYSQL_DATABASE=analytics
MYSQL_USER=analytics
MYSQL_PASSWORD=local-app-password-change-me
NODE_ENV=development
JWT_SECRET=local-development-secret-at-least-32-characters
PASSWORD_PEPPER=local-development-pepper-at-least-16
CLIENT_ORIGIN=http://localhost:8080
CORS_ORIGINS=http://localhost:8080
TRUSTED_HOSTS=localhost,127.0.0.1
METRICS_TOKEN=local-metrics-token-at-least-24-characters
FRONTEND_PORT=8080
```

Start the HTTP-only local topology:

```powershell
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

Then open `http://localhost:8080` and confirm `http://localhost:8080/api/health/ready` returns `"status": "OK"`.

Stop the stack with `Ctrl+C`, or in another terminal:

```powershell
docker compose -f docker-compose.yml -f docker-compose.local.yml down
```

Use the base `docker-compose.yml` alone only behind a real TLS-terminating reverse proxy. It intentionally enforces HTTPS and production safeguards.

## 3. No-Docker native development with SQLite

Use this path if Docker Desktop cannot be installed because of organization policy, Windows edition, virtualization restrictions, or hardware constraints. It is deliberately limited to local development; SQLite must not be used for a multi-instance or public production deployment.

### 3.1 Install project dependencies

Install Node.js 20+ and Python 3.11+ using your organization's approved method. From the repository root, run:

```powershell
npm run install:all
```

### 3.2 Create the backend environment file

Create `backend/.env` with the following development-only configuration:

```dotenv
NODE_ENV=development
DATABASE_URL=sqlite+aiosqlite:///./analytics.db
JWT_SECRET=local-development-secret-at-least-32-characters
PASSWORD_PEPPER=local-development-pepper-at-least-16
CLIENT_ORIGIN=http://localhost:5173
CORS_ORIGINS=http://localhost:5173
TRUSTED_HOSTS=localhost,127.0.0.1
TRUST_PROXY_HEADERS=false
FORCE_HTTPS=false
UPLOAD_PATH=./uploads
REDIS_URL=
RATE_LIMIT_STORAGE_URL=
METRICS_TOKEN=local-metrics-token-at-least-24-characters
```

The SQLite file is created at `backend/analytics.db`; uploaded source files and completed export files are stored below `backend/uploads`. Both are local state and should be backed up if the data matters.

### 3.3 Create or migrate the local schema

Run this once before starting the worker:

```powershell
Set-Location backend
.\venv\Scripts\alembic.exe -c alembic.ini upgrade head
Set-Location ..
```

### 3.4 Start the four local processes

After the dependencies and `backend/.env` are configured, the simplest option is to double-click `dev.bat` in the repository root. It applies migrations, opens four service windows, and launches `http://localhost:5173` in your browser. Close those four windows when finished.

If you prefer to start processes manually, open four PowerShell terminals in the repository root:

```powershell
npm run dev:frontend
npm run dev:backend
npm run dev:worker
npm run dev:maintenance
```

The first two provide the dashboard at `http://localhost:5173` and API at `http://localhost:5000`. The worker processes durable analytics/export jobs. Maintenance runs scheduled safe cleanup; use `npm run reconcile:storage` for a one-time report.

### 3.5 Verify and stop

```powershell
Invoke-WebRequest http://localhost:5000/health/ready | Select-Object -Expand Content
npm run check
```

Stop each process with `Ctrl+C`. To reset native development data, stop all four processes first, then delete only the explicitly named `backend/analytics.db` and `backend/uploads` locations if you no longer need their data.

## 4. When Docker/SQLite are not appropriate

For a shared or public deployment, run the application with managed MySQL, Redis, durable uploads, a TLS reverse proxy, and an external metrics/log collector. Follow [Deployment](deployment.md) for the required production settings; do not expose the backend directly to the Internet.
