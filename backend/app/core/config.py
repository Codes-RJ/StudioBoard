import os
import re
from ipaddress import ip_network
from urllib.parse import quote, urlparse, unquote
from typing import List, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, field_validator


def normalize_database_url(url: str) -> str:
    """
    Ensure MySQL URL is properly formatted for async SQLAlchemy (mysql+aiomysql://).
    Handles passwords containing '@' or other special characters safely.
    """
    if not url:
        return "mysql+aiomysql://root:password@localhost:3306/analytics"

    if url.startswith("mysql://") or url.startswith("mysql+aiomysql://") or url.startswith("mysql+pymysql://"):
        # Match mysql://user:password@host:port/dbname with regex to safely extract unencoded passwords
        match = re.match(r"^mysql(?:\+[a-z]+)?://([^:]+):(.*)@([^:/]+)(?::(\d+))?/(.+)$", url)
        if match:
            user, raw_password, host, port, db = match.groups()
            port_str = f":{port}" if port else ":3306"
            # Decode if already encoded, then encode once
            decoded_pwd = unquote(raw_password)
            encoded_pwd = quote(decoded_pwd, safe="")
            return f"mysql+aiomysql://{user}:{encoded_pwd}@{host}{port_str}/{db}"

    return url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    NODE_ENV: str = Field(default="development", description="Environment mode")
    ALLOW_SERVER_WORKSPACE: bool = Field(default=False, description="Explicitly enable the separate legacy server workspace")
    PORT: int = Field(default=5000, description="Server port")
    DATABASE_URL: str = Field(
        default="mysql://root:password@localhost:3306/analytics",
        description="Database connection string"
    )
    
    JWT_SECRET: str = Field(default="your-super-secret-key-change-in-production-min-32-chars", min_length=16)
    JWT_EXPIRES_IN: str = Field(default="8h")
    PASSWORD_PEPPER: str = Field(default="")
    
    CLIENT_ORIGIN: str = Field(default="http://localhost:5173")
    CORS_ORIGINS: str = Field(default="http://localhost:5173")
    
    UPLOAD_PATH: str = Field(default="./uploads")
    UPLOAD_MAX_SIZE: int = Field(default=104857600)  # 100MB
    MAX_DATASET_ROWS: int = Field(default=1000000)
    MAX_DATASET_COLUMNS: int = Field(default=500)
    DATAFRAME_CACHE_MAX_ENTRIES: int = Field(default=2, ge=0, le=20)
    DATAFRAME_CACHE_MAX_FILE_BYTES: int = Field(default=10 * 1024 * 1024, ge=0)
    ANALYTICS_MAX_CONCURRENT_REQUESTS: int = Field(default=4, ge=1, le=32)
    ANALYTICS_MAX_RESPONSE_BYTES: int = Field(default=5 * 1024 * 1024, ge=64 * 1024)
    JOB_MAX_RESULT_BYTES: int = Field(default=20 * 1024 * 1024, ge=64 * 1024)
    INTERACTIVE_EXPORT_MAX_BYTES: int = Field(default=10 * 1024 * 1024, ge=64 * 1024)
    JOB_MAX_ARTIFACT_BYTES: int = Field(default=250 * 1024 * 1024, ge=64 * 1024)
    LIVE_MAX_CONNECTIONS: int = Field(default=100, ge=1, le=10000)
    LIVE_SNAPSHOT_CACHE_MAX_ENTRIES: int = Field(default=32, ge=0, le=1000)
    LIVE_SNAPSHOT_CACHE_MAX_BYTES: int = Field(default=16 * 1024 * 1024, ge=0)
    JOB_WORKER_POLL_SECONDS: int = Field(default=2, ge=1, le=60)
    JOB_STALE_AFTER_SECONDS: int = Field(default=900, ge=60, le=86400)
    JOB_MAX_ATTEMPTS: int = Field(default=3, ge=1, le=10)
    JOB_RESULT_RETENTION_HOURS: int = Field(default=24, ge=1, le=720)
    STORAGE_RECONCILE_INTERVAL_SECONDS: int = Field(default=21600, ge=300, le=604800)
    STORAGE_ORPHAN_GRACE_SECONDS: int = Field(default=86400, ge=300, le=2592000)
    TELEMETRY_MAX_UNIQUE_IPS: int = Field(default=10000, ge=0)
    METRICS_TOKEN: Optional[str] = Field(default=None)
    USER_STORAGE_QUOTA_MB: int = Field(default=250)
    USER_DATASET_LIMIT: int = Field(default=25)
    
    REDIS_URL: Optional[str] = Field(default=None)
    RATE_LIMIT_WINDOW_MS: int = Field(default=900000)
    RATE_LIMIT_MAX: int = Field(default=100)
    RATE_LIMITING_DISABLED: bool = Field(default=False)
    RATE_LIMIT_STORAGE_URL: Optional[str] = Field(default=None)
    TRUSTED_HOSTS: str = Field(default="localhost,127.0.0.1,test")
    TRUST_PROXY_HEADERS: bool = Field(default=False)
    TRUSTED_PROXY_CIDRS: str = Field(default="", description="Comma-separated immediate proxy IPs/CIDRs; no implicit private-network trust")
    FORCE_HTTPS: bool = Field(default=False)
    DEV_AUTH_BYPASS: bool = Field(default=False)
    AI_LAYOUT_ENABLED: bool = Field(default=False)
    OPENAI_API_KEY: str = Field(default="")
    OPENAI_MODEL: str = Field(default="gpt-6-astra", min_length=1, max_length=80)
    OPENAI_TIMEOUT_SECONDS: int = Field(default=25, ge=5, le=60)

    @field_validator("TRUSTED_PROXY_CIDRS")
    @classmethod
    def validate_proxy_networks(cls, value: str) -> str:
        for entry in value.split(","):
            if entry.strip() and ip_network(entry.strip(), strict=False).prefixlen == 0:
                raise ValueError("Universal proxy trust is forbidden")
        return value

    @property
    def async_database_url(self) -> str:
        return normalize_database_url(self.DATABASE_URL)

    @property
    def cors_origins_list(self) -> List[str]:
        origins = [orig.strip() for orig in self.CORS_ORIGINS.split(",") if orig.strip()]
        if self.CLIENT_ORIGIN and self.CLIENT_ORIGIN not in origins:
            origins.append(self.CLIENT_ORIGIN)
        return origins

    @property
    def trusted_hosts_list(self) -> List[str]:
        return [host.strip() for host in self.TRUSTED_HOSTS.split(",") if host.strip()]

    @property
    def default_rate_limit(self) -> str:
        window_minutes = max(1, (self.RATE_LIMIT_WINDOW_MS + 59999) // 60000)
        return f"{self.RATE_LIMIT_MAX}/{window_minutes} minute"

    @property
    def is_production(self) -> bool:
        return self.NODE_ENV.lower() == "production"


settings = Settings()


def is_shared_rate_store(value: Optional[str]) -> bool:
    try:
        parsed = urlparse(value or "")
        return parsed.scheme in {"redis", "rediss"} and bool(parsed.hostname) and (
            parsed.port is None or 0 < parsed.port < 65536
        ) and not parsed.fragment
    except ValueError:
        return False

# SECURITY: refuse to serve production traffic with the well-known default
# signing secret — tokens would be forgeable by anyone who reads the source.
_KNOWN_DEFAULT_SECRETS = {"your-super-secret-key-change-in-production-min-32-chars"}
_KNOWN_INSECURE_DATABASE_VALUES = ("root:password@", "root:root@", "analytics:analytics@")

if settings.is_production:
    production_errors = []
    if settings.JWT_SECRET in _KNOWN_DEFAULT_SECRETS or len(settings.JWT_SECRET) < 32:
        production_errors.append("JWT_SECRET must be a unique value of at least 32 characters")
    if len(settings.PASSWORD_PEPPER) < 16:
        production_errors.append("PASSWORD_PEPPER must be a unique value of at least 16 characters")
    if any(value in settings.DATABASE_URL for value in _KNOWN_INSECURE_DATABASE_VALUES):
        production_errors.append("DATABASE_URL must not use a bundled default credential")
    if settings.DEV_AUTH_BYPASS:
        production_errors.append("DEV_AUTH_BYPASS must be false")
    if settings.AI_LAYOUT_ENABLED and not settings.OPENAI_API_KEY:
        production_errors.append("OPENAI_API_KEY is required when optional AI layout assistance is enabled")
    if settings.RATE_LIMITING_DISABLED:
        production_errors.append("RATE_LIMITING_DISABLED must be false")
    if not is_shared_rate_store(settings.RATE_LIMIT_STORAGE_URL):
        production_errors.append("RATE_LIMIT_STORAGE_URL must use a shared redis:// or rediss:// production store")
    if settings.TRUST_PROXY_HEADERS and not settings.TRUSTED_PROXY_CIDRS.strip():
        production_errors.append("TRUSTED_PROXY_CIDRS must explicitly identify immediate trusted proxies")
    if not settings.METRICS_TOKEN or len(settings.METRICS_TOKEN) < 24:
        production_errors.append("METRICS_TOKEN must be a unique value of at least 24 characters")
    if not settings.FORCE_HTTPS:
        production_errors.append("FORCE_HTTPS must be true behind a TLS-terminating proxy")
    if not settings.CLIENT_ORIGIN.startswith("https://"):
        production_errors.append("CLIENT_ORIGIN must be an HTTPS origin")
    if not settings.cors_origins_list or any("*" in origin or not origin.startswith("https://") for origin in settings.cors_origins_list):
        production_errors.append("CORS_ORIGINS must contain only exact HTTPS origins")
    if not settings.trusted_hosts_list or any(host == "*" for host in settings.trusted_hosts_list):
        production_errors.append("TRUSTED_HOSTS must list exact public hostnames")

    if production_errors:
        raise RuntimeError("Invalid production configuration: " + "; ".join(production_errors))
