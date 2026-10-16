# Development

## Prerequisites

- Node.js 22.13 or later in the Node 22 release line
- Python 3.12 for backend tests or the separate legacy server edition
- MySQL 8 / SQLite only for the separate legacy server edition
- Docker is optional; the personal container deployment serves static frontend assets only

## Install

From the repository root:

```powershell
npm run install:frontend
```

For backend tests or legacy development, `npm run install:all` additionally creates `backend/venv` and installs backend requirements. The virtual environment is local-only and ignored by Git.

## Run Locally

Start the personal browser-only application:

```powershell
npm run dev
```

No backend, account, or database is needed. The frontend is available at `http://localhost:5173` and performs no session/settings/API requests by default.

For a separate legacy server edition, explicitly set `VITE_ENABLE_SERVER_WORKSPACE=true` in the frontend environment and `ALLOW_SERVER_WORKSPACE=true` in the backend environment, then use `npm run dev:server`. Or start its applications independently:

```powershell
npm run dev:backend
npm run dev:frontend
```

Only the separately enabled server frontend calls `http://localhost:5000/api`. Its API documentation is available at `http://localhost:5000/docs`.

The dashboard works without the backend for browser-local file analysis. Server-backed dataset operations need a configured database. Use MySQL for a production-like workflow or the documented SQLite fallback for local development. See [Windows Docker and no-Docker setup](windows-setup.md) for the complete, copyable commands—including the separate durable worker and maintenance processes.

## Test and Build

Run the full repository check:

```powershell
npm run check
```

This runs the incremental lint/type gate, performs a Vite production build, checks the route/worker/asset size budgets,
runs the Vitest suites, then runs the FastAPI test suite. Backend tests use a
temporary SQLite database; real MySQL/Redis integration cases skip unless their disposable services are configured. The personal frontend alone can be checked with `npm.cmd --prefix frontend run check`. See [contract coverage](frontend-contract-checks.md) and [launch checks](launch-actions.md).

Run a focused suite when iterating:

```powershell
npm run test:frontend
npm run test:backend
```

## Important Environment Variables

The backend reads `.env` from the `backend` working directory. Common variables are:

```dotenv
NODE_ENV=development
ALLOW_SERVER_WORKSPACE=false
DATABASE_URL=mysql+aiomysql://analytics:analytics@localhost:3306/analytics
JWT_SECRET=replace-with-a-long-unique-secret
JWT_EXPIRES_IN=7d
PASSWORD_PEPPER=
CLIENT_ORIGIN=http://localhost:5173
CORS_ORIGINS=http://localhost:5173
UPLOAD_PATH=./uploads
UPLOAD_MAX_SIZE=104857600
REDIS_URL=
DEV_AUTH_BYPASS=false
RATE_LIMITING_DISABLED=false
RATE_LIMIT_STORAGE_URL=
TRUSTED_HOSTS=localhost,127.0.0.1
TRUST_PROXY_HEADERS=false
FORCE_HTTPS=false
MAX_DATASET_ROWS=1000000
MAX_DATASET_COLUMNS=500
DATAFRAME_CACHE_MAX_ENTRIES=2
DATAFRAME_CACHE_MAX_FILE_BYTES=10485760
ANALYTICS_MAX_CONCURRENT_REQUESTS=4
LIVE_MAX_CONNECTIONS=100
```

Never use the default JWT secret in a production environment. In production the application refuses to start with its known default secret.

To create or replace the sole administrator, set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and optionally `ADMIN_NAME` in the shell, then run `npm run reset:admin`. This removes every existing user and the server-uploaded datasets that belong to them; see [Maintenance](maintenance.md) before using it.
