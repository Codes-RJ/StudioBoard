# Conditional server portfolio deployment

This guide describes the separate legacy server edition. For the browser-only personal application, build and serve `frontend/dist` on a static host or use `docker-compose.personal.yml`; see [Deployment](deployment.md). That application needs no MySQL, API, account service, or server workspace storage.

The legacy procedure below deploys the existing server Docker Compose stack for a student portfolio without a paid domain or professional email. It explicitly enables server operations and does not meet the personal application's device-only storage requirement.

## Portfolio-ready versus business-grade

Portfolio-ready means a secure, repeatable public demo. Free resources may be paused or unavailable and have no uptime guarantee. Business-grade additionally requires a stable domain, tested managed backups, durable object storage, alerting, failover, legal/privacy pages, and an SLA.

## Recommended topology

1. Create an Oracle Cloud Always Free Ubuntu VM.
2. Run this repository's `docker-compose.yml` there (MySQL, Redis, FastAPI, worker, maintenance, and Nginx).
3. Keep port 8080 private and expose it through a Cloudflare Quick Tunnel for temporary HTTPS.
4. Use a personal email for the administrator and provider notices; do not publish it in the app.

Supabase is PostgreSQL, not MySQL. Moving to it would require a new driver, URL, migrations, and data/test migration, so it is not a drop-in free replacement.

## 1. Create the VM

In Oracle Cloud Console, create an Ubuntu Always Free compute instance in your home region, add an SSH key, and assign a public IPv4 address. Allow TCP 22 only from your IP. Do not open ports 3306, 6379, or 5000 publicly. Free resources can require card verification and may be unavailable in some regions; stop if paid resources are shown.

```bash
sudo apt update && sudo apt upgrade -y
```

## 2. Install Docker (Ubuntu)

```bash
sudo apt install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
newgrp docker
docker --version
docker compose version
```

## 3. Deploy

```bash
git clone <your-repository-url> analytics-dashboard
cd analytics-dashboard
cp .env.example .env
```

Edit `.env` and replace all blank values. Use unique long values for `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD`, `JWT_SECRET` (32+ characters), `PASSWORD_PEPPER` (16+), and `METRICS_TOKEN` (24+). Set `NODE_ENV=production`, `TRUST_PROXY_HEADERS=true`, `FORCE_HTTPS=true`, `RATE_LIMIT_STORAGE_URL=redis://redis:6379/1`, and `VITE_API_BASE_URL=/api`. Set `FRONTEND_PORT=8080`. The three origin/host values must exactly match the HTTPS tunnel hostname after Step 5.

Also configure `TRUSTED_PROXY_CIDRS` for the actual Nginx-to-backend peer and `TRUSTED_EDGE_CIDR` for the actual tunnel-to-Nginx peer. Container gateways often differ from loopback; inspect the topology and use stable narrow ingress addresses rather than trusting all private networks. The external edge must replace incoming forwarding headers. See [the proxy deployment contract](deployment.md#reverse-proxy-and-tls). These commands are a deployment recipe, not evidence that this topology has been run here. Complete the [launch checks](launch-actions.md) first, including real server infrastructure and a fresh dependency/advisory review. Local checks do not certify this deployment.

```bash
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 backend worker maintenance frontend
curl -fsS http://127.0.0.1:8080/health/ready
```

## 4. Bootstrap the administrator

Use a strong personal email/password:

```bash
docker compose exec -e ADMIN_EMAIL=you@example.com -e ADMIN_PASSWORD='use-a-new-12-character-password' backend python reset_admin.py --confirm
```

Alternatively, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in the VM shell and run `npm run reset:admin` from the repository root.
This command replaces the existing users and their server datasets; run it only on a new/confirmed database.

## 5. Temporary HTTPS without a domain

Install `cloudflared` from Cloudflare's official instructions, then run:

```bash
cloudflared tunnel --url http://127.0.0.1:8080
```

Copy the generated `https://*.trycloudflare.com` host into `CLIENT_ORIGIN`, `CORS_ORIGINS`, and `TRUSTED_HOSTS`, then run `docker compose up -d --build`. Keep `cloudflared` running (for example in `tmux`). The hostname changes when recreated and Quick Tunnels have no SLA, so this is a portfolio demo rather than a dependable public service.

## 6. Backups and shutdown

Periodically copy the MySQL volume and uploads to private storage. Example commands (run from the repository directory):

```bash
mkdir -p backups
docker run --rm -v analytics-dashboard_mysql_data:/from -v "$PWD/backups":/to alpine tar czf /to/mysql-backup.tgz -C /from .
docker run --rm -v analytics-dashboard_uploads_data:/from -v "$PWD/backups":/to alpine tar czf /to/uploads-backup.tgz -C /from .
```

Use `docker compose stop` to pause. Do not use `down -v` unless you intend to erase volumes.

## Go-live checklist

- Run `npm run check` before every deployment.
- Test HTTPS login, upload, analytics, and export through `/api`.
- Keep `/metrics`, MySQL, Redis, and port 5000 private.
- Check health endpoints and logs after VM reboots.
- Document the free-demo limitations and changing URL in your portfolio.

Oracle documents one Always Free MySQL DB system per tenancy in the home region, fixed storage, one-day backup retention, and no SLA. Cloudflare documents no uptime/SLA guarantee for Quick Tunnels. Re-check provider terms before relying on the demo.
