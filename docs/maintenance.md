# Maintenance

Server migrations use `backend/alembic.ini` from the backend working directory (the launcher, CI and container agree). The root `alembic.ini` is retained as an alternative for existing operators; it is not a cleanup deletion. Do not apply migrations to real databases as part of repository housekeeping.

## Dependency Management

- Frontend versions are locked by `frontend/package-lock.json`.
- Root development tooling is locked by `package-lock.json`.
- Backend runtime dependency policy lives in `backend/requirements.in`; test-only packages live in `backend/requirements-dev.in`. Their fully resolved, hash-locked install files are `requirements.txt` and `requirements-dev.txt`. CI/local development installs both; containers install only the runtime lock.

Update one dependency family at a time, run `npm run check`, and inspect the generated frontend bundle before shipping an upgrade. Keep `pandas`, `numpy`, `scipy`, `scikit-learn`, `openpyxl`, and `pyarrow` aligned with the supported Python version in the backend Docker image.

Server XLS input uses the runtime-pinned `xlrd` parser; XLSX uses `openpyxl`. The [xlrd 2.0.2 package](https://pypi.org/project/xlrd/2.0.2/) supports legacy XLS input. CI and containers consume the runtime lock, so the parser must remain there rather than only in a developer environment. The input explicitly requests Uvicorn's standard dependencies to preserve the existing runtime set when regenerating locks. Use Python 3.12 for the supported server lock; keep existing package versions unless intentionally updating that family. Real BIFF8 and corrupt-upload coverage lives in `backend/tests/test_xls_support.py`.

After editing either input, regenerate both locks from the repository root:

```powershell
backend\venv\Scripts\python.exe -m piptools compile --generate-hashes --output-file backend/requirements.txt backend/requirements.in
backend\venv\Scripts\python.exe -m piptools compile --generate-hashes --output-file backend/requirements-dev.txt backend/requirements-dev.in
```

CI audits the complete npm tree and scans both runtime images for high and critical vulnerabilities.

## Database Changes

Durable job work computes outside database transactions. The attempt counter fences result/error publication and renewal; a queued, replaced or expired attempt cannot publish. Worker lease renewal uses separate short transactions, and final publication clears the expiry. An expired export deletes only its own attempt file. Artifact leases cover writing through publication, with cancellation draining owned writes/commits before releasing the lease. Completed accepted exports remain available after an interrupted worker response. Old workers must be stopped for the `20261009_07` migration rollout; see deployment guidance.

Development and test startup can create disposable SQLAlchemy tables. Production containers apply Alembic migrations before Uvicorn starts. Before changing models, create and test an Alembic migration; do not rely on `create_all()` to alter a deployed schema.

## Storage Lifecycle

Each API process keeps live snapshots in a local LRU bounded by `LIVE_SNAPSHOT_CACHE_MAX_ENTRIES` (32) and `LIVE_SNAPSHOT_CACHE_MAX_BYTES` (16 MiB of serialized JSON). Oversized snapshots are served without local retention; setting either limit to zero disables retention. Expired entries are pruned on the next snapshot/invalidation operation, and deleted/refreshed datasets invalidate after active local builders finish. Sixty-four fixed lock stripes avoid per-dataset lock retention. The serialized budget is not a Python heap or transient calculation-memory limit; Redis retains its separate 15-second TTL, and deployment capacity still requires measurements.

Server-uploaded files and database rows must be treated as one unit. `DatasetService` removes the file when a dataset is deleted, but operational backups and retention work must cover both MySQL and `UPLOAD_PATH`.

Upload quota admission uses per-account native leases under `.storage-locks/accounts` on the shared upload volume, separate from artifact stripes. Hold admission from the current committed quota read through file validation and metadata commit. All API processes must share this volume with working filesystem locks. MySQL quota reads use a current locking read so an earlier authentication snapshot cannot hide newly committed uploads. Cancelled staging/parsing removes owned files; cancellation during metadata commit drains that commit before releasing admission, retaining accepted files if the commit succeeded. A cancelled response can therefore represent an accepted dataset: refresh the dataset list before retrying. Account and artifact coordination files must remain excluded from reclamation.

Local browser datasets are intentionally separate from server datasets. Complete local datasets are retained in browser IndexedDB, while compact preferences such as dashboard layout remain in `localStorage`; clearing site data removes both.

Run a storage reconciliation after interrupted deploys, manual data recovery, or failed filesystem cleanup. The default is read-only; deletion requires an explicit flag:

```powershell
cd backend
.\venv\Scripts\python reconcile_storage.py
.\venv\Scripts\python reconcile_storage.py --delete-orphans
```

Deletion considers only untracked files older than `STORAGE_ORPHAN_GRACE_SECONDS` (24 hours by default). Active upload leases protect both staging and promoted files through metadata commit, and existing durable jobs reserve their staged/promoted export filenames. Ownership is read again before deletion. Fresh files remain candidates in the report but are retained; abandoned `.part` files become reclaimable after the grace period.

Every backend role must share a filesystem with working cross-process locks. Keep `.storage-locks` and its bounded coordination files intact while any role is running. Do not use maintenance as a replacement for coordinated database/upload backups or run cleanup against an unverified upload directory.

## Administrator Reset

Public user registration is disabled. The repository provides one deliberate bootstrap command for replacing every user with a single administrator:

```powershell
$env:ADMIN_EMAIL = "admin@example.com"
$env:ADMIN_PASSWORD = "use-a-long-unique-password"
$env:ADMIN_NAME = "Administrator"
npm run reset:admin
```

The command requires a 12-character-or-longer password and an explicit `--confirm` flag supplied by the package script. It deletes all users, their server-side dataset records, saved layouts, audit rows, and uploaded dataset files before creating the administrator. Run it only against the intended database after confirming `DATABASE_URL`; use `backend/reset_admin.py` without `--confirm` for a dry-run count.

## Observability

The backend exposes:

- `GET /health/live` for process liveness and `GET /health/ready` for database readiness
- token-protected `GET /metrics` for Prometheus/OpenMetrics-compatible request and job counts
- `AnalyticsJob` records for queued, running, succeeded, and failed durable work
- request telemetry in process memory
- optional Redis-backed telemetry mirrors when `REDIS_URL` is configured

In-memory telemetry resets on restart and is not a substitute for durable application logs or infrastructure monitoring.

Each completed HTTP request is also emitted as a JSON event to the container's standard log stream. Configure the deployment platform's log driver or collector to retain and alert on these events. In-memory telemetry keeps at most 500 recent requests and a configurable number of unique client IPs.

## Follow-up work

Migrations, durable jobs and browser workers already exist; verify their applicable real CI, server and device acceptance before deployment. Use [capacity measurements](browser-capacity.md) before choosing further performance architecture changes.
