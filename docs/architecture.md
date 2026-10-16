# Architecture

## System Boundaries

The default personal application is a static frontend. `VITE_ENABLE_SERVER_WORKSPACE=false` prevents startup API requests and blocks all API transports, server layout operations, remote AI, and live streams. Local datasets use IndexedDB; layouts/preferences use browser storage. `docker-compose.personal.yml` deploys only this frontend and rejects `/api` requests without a proxy.

The repository also retains a separate legacy server edition. It requires a frontend build with `VITE_ENABLE_SERVER_WORKSPACE=true` and backend configuration with `ALLOW_SERVER_WORKSPACE=true`. The following server topology applies only to that edition:

```text
Browser
  React application
    localDataEngine, dataCleaner, aiQueryEngine
    DashboardContext and dashboard components
  | optional authenticated HTTP and SSE
  v
FastAPI application (/api)
  route handlers -> services -> repositories -> MySQL
  analytics strategies -> Pandas / NumPy / SciPy / scikit-learn
  uploaded files -> configured UPLOAD_PATH
  durable analytics jobs -> MySQL -> analytics worker
```

Docker Compose starts MySQL, Redis, the FastAPI backend, an analytics worker, a maintenance worker, and an Nginx-served frontend. Production readiness requires Redis for shared rate limiting. Dataset snapshot caching and role heartbeats also use Redis; development can run without it.

## Frontend

`frontend/src/App.jsx` composes the router, theme, authentication context, dashboard context, navigation, and error boundaries. The routes are intentionally small:

- `/`: product homepage
- `/dashboard`: dashboard workspace
- `/upload`: local file or public-URL import
- `/login`: redirects to the local dashboard in the personal edition; administrator login in the legacy edition
- `/admin`: redirects to the local dashboard in the personal edition; administrator overview in the legacy edition
- `/terms` and `/privacy`: legal pages

The normal dashboard path is local-first. `localDataEngine` parses CSV, TSV, TXT, XLSX, and XLS files in the browser and stores complete local datasets in IndexedDB. IndexedDB writes are serialized and update individual datasets; pending edits flush when the page becomes hidden, and the UI reports browser storage pressure. It provides filtering, pagination, layout planning, and export helpers. CSV parsing, spreadsheet parsing, cleaning, and assistant calculations use workers where available. `dataCleaner`, `aiQueryEngine`, and `reportGenerator` operate on the same browser-resident dataset.

`DashboardContext` owns selected datasets, filters, persisted layouts, and local/server data selection. `SiteSettingsContext` uses local defaults in the personal edition and retrieves public configuration only in the legacy edition. `ChartPanel` and `DataTable` use browser-local rows; server endpoint access requires the separately enabled legacy build. Advanced statistical, grouped wave/curve, 3D, and 4D chart types lazy-load Plotly so the default dashboard route does not pay the interactive renderer cost.

Current frontend responsibility boundaries are documented in [module ownership](frontend-module-boundaries.md): source selection owns cancellation/version guards, layout editing owns history commands, chart/summary hooks own computation, and database/import modules share one write queue. [Analytics fixtures](analytics-contracts.md) specify exact arithmetic and intentional server differences; [capacity measurements](browser-capacity.md) record slower-CPU responsiveness limits.

## Backend

`backend/app/main.py` mounts a single FastAPI application at `/api`; route groups do not use a version prefix.

| Route group | Responsibility |
| --- | --- |
| `/api/auth` | Login, logout, and current-user session lookup |
| `/api/admin` | Administrator overview and user directory |
| `/api/datasets` | Upload, list, metadata, paged data, export, deletion, and layout planning |
| `/api/analytics` | Interactive statistics, correlation, regression, pivot, time series, outliers, missing values, live snapshots/SSE, and durable job submission, status, and downloads |
| `/api/layouts` | Per-user saved dashboard layouts |
| `/api/config` | Validated public branding, sections, and feature policy; `/api/admin/config` requires an admin and CSRF token |

The backend uses a repository layer for `User`, `Dataset`, `DashboardLayout`, `Log`, and `SiteConfig`. `DatasetService` validates and persists uploaded files, calculates metadata, and builds live snapshots. `AnalyticsEngine` resolves a named strategy and loads the server-resolved dataset path, so analytics callers cannot provide arbitrary filesystem paths.

Server outlier results use source DataFrame index labels for `outlier_indices` in both IQR and z-score methods. Uploaded-file loaders assign zero-based data-row labels (excluding the header); missing or invalid numeric rows do not renumber later rows. Direct strategy callers must supply integer source-row labels.

Server time-series trends compare the first and last observed period means, including zero and negative values. Empty periods keep the existing zero-filled mean/sum representation with `count: 0`; consumers must use count to distinguish them from observed zero means. Empty periods do not participate in the trend.

## Identity and Data Ownership

Production API routes require a valid JWT in the HttpOnly `token` cookie or an HTTP bearer token. JWTs carry the user's current token version; logout increments that version so previously issued tokens cannot be replayed. Passwords use versioned, peppered HMAC-SHA256 material before bcrypt, allowing long Unicode passwords without bcrypt's input limit, and successful login upgrades legacy hashes. Cookie-authenticated writes also require a matching CSRF token. Dataset, layout, and analytics access is scoped to the current user, with server feature policy enforced before a route executes. Public registration is intentionally unavailable; bootstrap the single administrator with `reset_admin.py`.

The server has no implicit development identity. `DEV_AUTH_BYPASS=true` exists only for isolated test fixtures and should not be set for an interactive environment. Production startup rejects placeholder secrets, default database passwords, HTTP CORS origins, wildcard trusted hosts, disabled rate limits, and disabled HTTPS enforcement.

## Persistence

MySQL stores application metadata. Saved layouts carry an integer version, and updates use an atomic version comparison so another browser session receives a conflict instead of silently overwriting newer work. Dataset content remains in files under `UPLOAD_PATH`; Docker Compose shares the non-root-safe `uploads_data` named volume between the API, worker, and maintenance roles. Native development continues to use `backend/uploads`. Development and tests may use `init_db()` to create disposable tables, while production containers apply versioned Alembic migrations before startup.

## Operational Constraints

- Rendering large charts and some browser data transformations can still affect UI responsiveness despite worker-backed parsing and cleaning.
- Interactive server analytics use a bounded concurrency limiter and a small parsed-data cache. Longer work can be submitted as durable MySQL-backed jobs, but large datasets and concurrent jobs still need deployment-specific load testing.
- The SSE endpoint checks for an updated dataset snapshot every eight seconds; snapshots are cached briefly in memory and optionally Redis.
