# Deployment

For the personal edition, begin with the [hosting guide](personal-hosting.md) and [launch checks](launch-actions.md). The server instructions below remain a separate supported path.

## Personal browser-only deployment

The recommended personal deployment serves static assets and has no API, MySQL, Redis, upload volume, worker, or account service:

```powershell
docker compose -f docker-compose.personal.yml up --build -d
```

The frontend defaults to `VITE_ENABLE_SERVER_WORKSPACE=false`. Keep `VITE_ENABLE_EXPERIMENTAL_LOCAL_LLM=false` for release: the [assistant's frozen-question study](assistant-status.md) does not establish broad model reliability. This flag is enforced in the model runtime as well as the controls; deterministic calculations and evidence search remain available. Its container uses `nginx.local.conf`, which rejects `/api` requests and has no backend proxy. Place HTTPS termination in front of the loopback-bound frontend for public hosting. URL imports contact the selected HTTPS source directly and require that source to allow CORS. Static hosting still produces ordinary connection/access information; it never receives local workspace payloads through this application.

The [personal hosting guide](personal-hosting.md) describes static hosting. Its prepared build emits static headers/routes for Git builds or a manual `dist` upload. An owned project URL and actual edge acceptance remain pending; follow the [launch checks](launch-actions.md).

Alternatively, build the frontend and serve `frontend/dist` through a static host. Serve generated public/known workspace route HTML and return a real HTTP 404 for unknown routes; a blanket SPA fallback would undo that SEO behavior. `frontend/vercel.json` provides explicit route rewrites, while `nginx.local.conf` serves the generated files and keeps personal API routes disabled. Avoid attaching external analytics or error reporting that captures user content. Test the actual deployed network boundary.

Set `VITE_PUBLIC_SITE_URL` to the public HTTPS origin before building, for example in the static host's build environment or the personal Compose `.env`. It must have no path, query, fragment or credentials. The personal Docker build forwards it. With no chosen domain, leave it empty: public preview pages are `noindex` and no canonical domain is invented. Workspace routes remain `noindex` regardless; the sitemap contains only landing/How it works/privacy/terms. Public hosting, domain ownership, search indexing and Search Console are separate deployment validation.

Browser-local LLM/RAG/graph/layout functionality uses explicit model downloads. MiniLM load/index/citation/cached-reload/cache-deletion fixtures pass. Qwen generation now runs on a compatible GPU, while [measured agent quality and device limits](browser-local-ai.md) remain release gates. Full offline reopening remains unsupported without app-shell caching.

## Separate legacy server Docker Compose

Existing server deployments use the repository's `docker-compose.yml`, which explicitly enables `VITE_ENABLE_SERVER_WORKSPACE=true` at build time and `ALLOW_SERVER_WORKSPACE=true` for the API/worker/maintenance roles. This edition stores server data and does not meet the personal deployment's privacy requirement:

```powershell
docker compose up --build -d
docker compose ps
```

It starts MySQL, Redis, FastAPI, and Nginx. MySQL, Redis, and FastAPI remain on the private Compose network; only the Nginx frontend binds to `127.0.0.1:8080` by default. Put a TLS-terminating reverse proxy in front of that loopback address.

For a direct, HTTP-only local container run, use the local override instead of
the production command:

```powershell
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

The override sets the backend to development mode, disables forced HTTPS and
proxy-header trust, and permits the local frontend origin. Do not use it for a
public deployment.

Copy [`.env.example`](../.env.example) to a local `.env`, fill every required secret, and keep that file outside version control. Compose intentionally fails rather than starting with placeholder secrets or bundled database passwords.

For detailed Windows Docker Desktop installation and the non-container SQLite development alternative, see [Windows Docker and no-Docker setup](windows-setup.md). SQLite is for local development only, not a substitute for production MySQL.

## Required Production Configuration

Set these environment values before deployment rather than relying on Compose defaults:

```dotenv
MYSQL_ROOT_PASSWORD=<long-unique-root-password>
MYSQL_USER=analytics
MYSQL_PASSWORD=<long-unique-application-password>
MYSQL_DATABASE=analytics
JWT_SECRET=<long-random-secret-at-least-32-characters>
PASSWORD_PEPPER=<long-random-pepper-at-least-16-characters>
NODE_ENV=production
CLIENT_ORIGIN=https://app.example.com
CORS_ORIGINS=https://app.example.com
TRUSTED_HOSTS=app.example.com
TRUST_PROXY_HEADERS=true
TRUSTED_PROXY_CIDRS=<actual-nginx-backend-peer-or-narrow-ingress-CIDR>
TRUSTED_EDGE_CIDR=<actual-TLS-edge-peer-seen-by-nginx>
FORCE_HTTPS=true
RATE_LIMIT_STORAGE_URL=redis://redis:6379/1
METRICS_TOKEN=<long-random-metrics-token-at-least-24-characters>
VITE_API_BASE_URL=/api
UPLOAD_PATH=/app/uploads
```

`VITE_API_BASE_URL` is a frontend build-time value. The supported production topology uses the same-origin `/api` reverse proxy built into `frontend/nginx.conf`; do not expose the backend port directly to the Internet. Rebuild the frontend whenever it changes.

On a new production database, the backend container applies Alembic migrations before starting Uvicorn. Existing databases created before migrations were introduced must be backed up and inspected, then stamped at the baseline revision (`alembic -c backend/alembic.ini stamp 20260829_01`) before their first migration-backed deployment; the next migration converts legacy JSON text fields to native JSON columns. Do not rely on application startup to modify a production schema.

## Reverse Proxy and TLS

Place the frontend behind a TLS-terminating reverse proxy that replaces client-supplied forwarding headers. There are two trust boundaries: Nginx accepts forwarding information only from `TRUSTED_EDGE_CIDR`, and FastAPI accepts it only from `TRUSTED_PROXY_CIDRS`. Set these to inspected immediate-peer addresses or narrow dedicated networks. The safe loopback edge default generally does not match a Docker gateway. Production with proxy trust rejects an empty backend allowlist. Do not permit every private network or the universal network as a workaround.

The server container substitutes `TRUSTED_EDGE_CIDR` into its Nginx template. Uvicorn runs with `--no-proxy-headers`; application code validates the original peer. Nginx replaces `X-Forwarded-For` with the validated client address and preserves SSE. Configure edge request-body limits consistently with `UPLOAD_MAX_SIZE`. Verify actual template substitution and headers in the chosen topology before launching; this workstation had no Docker service.

Production requires a shared Redis/rediss rate store. Protected requests fail with 503/retry guidance during store errors; there is no per-process fallback. Test independent workers and outages against disposable infrastructure. Set `REDIS_INTEGRATION_STORAGE_URL` only when intentionally running `backend/tests/test_redis_rate_integration.py`; it uses a unique temporary key, never a database flush.

The production backend requires HTTPS forwarding, exact trusted hostnames, exact HTTPS CORS origins, a strong JWT secret, a password pepper, and enabled rate limiting before it starts. API docs are disabled in production. Session cookies are `HttpOnly`, `Secure`, and paired with a CSRF token for write requests.

## Persistent Data and Backups

- Back up the Compose `mysql_data` volume.
- Back up the Compose `uploads_data` volume, which contains server-uploaded dataset files and queued export artifacts.
- Do not publish either location or place uploads inside the frontend static root.

The named uploads volume deliberately preserves UID 1000 ownership for the non-root API, worker, and maintenance containers. If upgrading an older deployment that bind-mounted `backend/uploads`, stop the stack and copy that directory into the new `uploads_data` volume before starting the new release; keep the original directory until a restore test confirms the migration.

## Workers, maintenance, and metrics

Compose starts three backend roles: the API, a durable analytics `worker`, and a `maintenance` service. The worker claims persisted jobs from `AnalyticsJob`, so queued analytics and exports are safe across API restarts. Reconciliation retains untracked files younger than `STORAGE_ORPHAN_GRACE_SECONDS` (24 hours by default), skips active upload leases and rechecks committed ownership before deletion. Durable job IDs reserve their staged/promoted export paths before `outputPath` commits. Tune the maintenance interval with `STORAGE_RECONCILE_INTERVAL_SECONDS` and completed export retention with `JOB_RESULT_RETENTION_HOURS`.

All backend roles must use the same upload volume with working cross-process filesystem locks. Upload leases cover streaming, parsing and the metadata commit; crashes release the OS lock and abandoned files become reclaimable after the grace period. The bounded `.storage-locks` directory contains coordination stripes, not upload data: do not remove it or its files while any role is running. Windows and POSIX use their native locking primitives; verify shared-volume locking when choosing a different filesystem/storage topology.

The worker and maintenance services publish Redis-backed heartbeats and have Compose health checks. Interactive analytics, background JSON results, synchronous exports, and job artifacts each have independent byte limits; tune them with `ANALYTICS_MAX_RESPONSE_BYTES`, `JOB_MAX_RESULT_BYTES`, `INTERACTIVE_EXPORT_MAX_BYTES`, and `JOB_MAX_ARTIFACT_BYTES` only after load testing.

The renewable-job-lease upgrade adds nullable `AnalyticsJob.leaseExpiresAt` in migration `20261009_07`. Stop or drain every old worker before applying this migration and starting the new worker release: mixed old/new workers cannot enforce attempt ownership. New workers renew in short independent transactions every third of `JOB_STALE_AFTER_SECONDS`; result publication requires the same attempt number, RUNNING status and an unexpired lease. Exports use attempt-specific filenames, and reclamation recognizes both these and legacy job filenames. Existing running rows without the new expiry retain startedAt-based stale recovery. Keep API/worker clocks synchronized. Apply and verify the migration against a backed-up/disposable server database before production rollout; the local migration round trip covers SQLite only.

Set a unique `METRICS_TOKEN` (at least 24 characters). Your metrics collector can scrape `/metrics` with `Authorization: Bearer <METRICS_TOKEN>`. Never expose this endpoint through the public frontend proxy.

## Before Go-Live

Follow the [launch checks](launch-actions.md) and obtain passing CI, physical-device and actual host/service evidence before launch. Refresh dependency audits and strict notices before release. Keep experimental generation disabled until a separate model-quality gate passes. After choosing and configuring the public origin, run `npm --prefix frontend run check:deployment -- https://your-owned-origin` for read-only delivery/SEO/header checks. No public host has been configured or tested here.

Nginx and Vercel templates set security headers, revalidate HTML/metadata and cache hashed assets immutably for one year. Nginx enables suitable compression. CSP permits controlled Blob modules/workers and WASM for MiniLM; actual HTTPS edge headers/HSTS, cache/compression and true unknown-route 404s must still be checked on the selected host. Set a stable `VITE_PUBLIC_SITE_URL` before generating public canonicals/sitemap.

- Run `npm run check`.
- Confirm the reverse proxy serves HTTPS and forwards `X-Forwarded-Proto: https`.
- Confirm `GET /health/ready` from the private network reports the database as connected. `/health/live` is dependency-free liveness.

- Bootstrap the sole administrator with `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `npm run reset:admin`.
- Confirm sign-in, CSRF-protected settings changes, dataset upload, descriptive analysis, export, and sign-out with the deployed hostname.
- Review the Admin page's server capability policies before making any feature available to authenticated users.

`npm --prefix frontend run build:release` explicitly disables experimental generation for the child build. Reserve `build:evaluation` for disposable local fixture work and rebuild the release afterward. Once an owned HTTPS host is selected, `npm --prefix frontend run check:host-traffic -- https://your-owned-origin --authorized --requests=30 --concurrency=2` performs a bounded, paced HTML response-header probe. It never sends workspace data or follows redirects; it does not establish burst capacity or hundreds of simultaneous browser sessions.
