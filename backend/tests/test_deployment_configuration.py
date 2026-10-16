import json
from pathlib import Path

import pytest

import app.main as main_module


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def test_personal_compose_hosts_only_static_assets_with_no_api_proxy():
    compose = (REPOSITORY_ROOT / 'docker-compose.personal.yml').read_text(encoding='utf-8')
    nginx = (REPOSITORY_ROOT / 'frontend' / 'nginx.local.conf').read_text(encoding='utf-8')
    dockerfile = (REPOSITORY_ROOT / 'frontend' / 'Dockerfile').read_text(encoding='utf-8')
    assert 'VITE_ENABLE_SERVER_WORKSPACE: "false"' in compose
    assert 'depends_on:' not in compose
    assert '  mysql:' not in compose and '  backend:' not in compose and '  worker:' not in compose
    assert 'proxy_pass' not in nginx
    assert 'location /api/ { return 404; }' in nginx
    assert 'ARG VITE_ENABLE_SERVER_WORKSPACE=false' in dockerfile
    assert 'COPY nginx.local.conf /etc/nginx/local-workspace.conf' in dockerfile


def test_nginx_forwards_a_nonempty_protocol_to_the_backend():
    nginx_config = (REPOSITORY_ROOT / "frontend" / "nginx.conf").read_text(encoding="utf-8")

    assert 'map "$analytics_trusted_edge:$http_x_forwarded_proto" $analytics_forwarded_proto' in nginx_config
    assert 'default $scheme;' in nginx_config
    assert '"1:https" https;' in nginx_config
    assert 'set_real_ip_from ${TRUSTED_EDGE_CIDR};' in nginx_config
    assert '$proxy_add_x_forwarded_for' not in nginx_config
    assert 'proxy_set_header X-Forwarded-For $remote_addr;' in nginx_config
    assert "proxy_set_header X-Forwarded-Proto $analytics_forwarded_proto;" in nginx_config


def test_nginx_maps_the_public_api_health_probe_to_the_root_health_router():
    nginx_config = (REPOSITORY_ROOT / "frontend" / "nginx.conf").read_text(encoding="utf-8")

    assert "location /api/health/" in nginx_config
    assert "proxy_pass http://backend:5000/health/;" in nginx_config


def test_local_compose_override_is_explicitly_http_only():
    local_compose = (REPOSITORY_ROOT / "docker-compose.local.yml").read_text(encoding="utf-8")

    assert "NODE_ENV: development" in local_compose
    assert 'TRUST_PROXY_HEADERS: "false"' in local_compose
    assert 'FORCE_HTTPS: "false"' in local_compose


def test_container_contexts_exclude_secrets_and_local_artifacts():
    backend_ignore = (REPOSITORY_ROOT / "backend" / ".dockerignore").read_text(encoding="utf-8")
    frontend_ignore = (REPOSITORY_ROOT / "frontend" / ".dockerignore").read_text(encoding="utf-8")
    backend_dockerfile = (REPOSITORY_ROOT / "backend" / "Dockerfile").read_text(encoding="utf-8")

    for entry in (".env", "uploads", "venv", "tests"):
        assert entry in backend_ignore
    for entry in (".env", "node_modules", "dist"):
        assert entry in frontend_ignore
    assert "COPY . ." not in backend_dockerfile
    assert "USER app" in backend_dockerfile


def test_compose_uses_one_non_root_safe_upload_volume_for_all_backend_roles():
    compose = (REPOSITORY_ROOT / "docker-compose.yml").read_text(encoding="utf-8")

    assert compose.count("- uploads_data:/app/uploads") == 3
    assert "./backend/uploads:/app/uploads" not in compose
    assert "  uploads_data:" in compose


def test_declared_runtime_versions_match_ci_containers_and_lockfiles():
    root_package = json.loads((REPOSITORY_ROOT / "package.json").read_text(encoding="utf-8"))
    frontend_package = json.loads((REPOSITORY_ROOT / "frontend" / "package.json").read_text(encoding="utf-8"))
    frontend_dockerfile = (REPOSITORY_ROOT / "frontend" / "Dockerfile").read_text(encoding="utf-8")
    backend_dockerfile = (REPOSITORY_ROOT / "backend" / "Dockerfile").read_text(encoding="utf-8")
    checks_workflow = (REPOSITORY_ROOT / ".github" / "workflows" / "checks.yml").read_text(encoding="utf-8")
    requirements_lock = (REPOSITORY_ROOT / "backend" / "requirements.txt").read_text(encoding="utf-8")
    dev_requirements_lock = (REPOSITORY_ROOT / "backend" / "requirements-dev.txt").read_text(encoding="utf-8")

    assert root_package["engines"]["node"] == ">=22.13 <23"
    assert frontend_package["engines"]["node"] == root_package["engines"]["node"]
    assert "FROM node:22-alpine" in frontend_dockerfile
    assert "RUN apk upgrade --no-cache" in frontend_dockerfile
    assert "node-version: 22" in checks_workflow

    assert "FROM python:3.12-slim" in backend_dockerfile
    assert "apt-get upgrade -y" in backend_dockerfile
    assert "python-version: '3.12'" in checks_workflow
    assert "pip-compile with Python 3.12" in requirements_lock
    assert "pip-compile with Python 3.12" in dev_requirements_lock


@pytest.mark.asyncio
async def test_readiness_uses_http_status_to_gate_database_failures(client, monkeypatch):
    healthy = await client.get("/health/ready")
    assert healthy.status_code == 200
    assert healthy.json()["services"]["database"] == "connected"
    assert 0 <= healthy.json()["uptime"] < 24 * 60 * 60

    class BrokenConnectionContext:
        async def __aenter__(self):
            raise RuntimeError("database unavailable")

        async def __aexit__(self, exc_type, exc, traceback):
            return False

    class BrokenEngine:
        def connect(self):
            return BrokenConnectionContext()

    monkeypatch.setattr(main_module, "engine", BrokenEngine())
    unavailable = await client.get("/health/ready")

    assert unavailable.status_code == 503
    assert unavailable.json()["status"] == "DEGRADED"
    assert unavailable.json()["services"]["database"] == "error"


@pytest.mark.asyncio
async def test_health_endpoints_report_the_application_version(client):
    live = await client.get("/health/live")
    ready = await client.get("/health/ready")

    assert live.status_code == 200
    assert live.json()["version"] == main_module.app.version
    assert ready.json()["version"] == main_module.app.version
