import datetime
import hashlib
import hmac
import secrets
from functools import lru_cache
from typing import Any, Dict, Optional
import bcrypt
import jwt
from app.core.config import settings


PASSWORD_HASH_VERSION = "v2$"


def apply_pepper(password: str) -> str:
    """Appends server-side pepper to password before hashing/verification."""
    pepper = settings.PASSWORD_PEPPER or ""
    return f"{password}{pepper}"


def _password_material(password: str) -> bytes:
    """Return fixed-length, peppered material so bcrypt never sees >72 bytes."""
    pepper = (settings.PASSWORD_PEPPER or "").encode("utf-8")
    return hmac.new(pepper, password.encode("utf-8"), hashlib.sha256).digest()


def hash_password(password: str) -> str:
    """Hash arbitrary-length Unicode passwords with a versioned bcrypt format."""
    salt = bcrypt.gensalt(rounds=12)
    hashed = bcrypt.hashpw(_password_material(password), salt).decode("utf-8")
    return f"{PASSWORD_HASH_VERSION}{hashed}"


def verify_password_with_upgrade(plain_password: str, hashed_password: str) -> tuple[bool, bool]:
    """Verify current and legacy hashes, reporting when a legacy hash should migrate."""
    try:
        if hashed_password.startswith(PASSWORD_HASH_VERSION):
            hash_bytes = hashed_password[len(PASSWORD_HASH_VERSION):].encode("utf-8")
            return bcrypt.checkpw(_password_material(plain_password), hash_bytes), False

        legacy_material = apply_pepper(plain_password).encode("utf-8")
        if len(legacy_material) > 72:
            return False, False
        valid = bcrypt.checkpw(legacy_material, hashed_password.encode("utf-8"))
        return valid, valid
    except (TypeError, ValueError):
        return False, False


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verifies a password against the stored bcrypt hash using server-side pepper.
    """
    valid, _ = verify_password_with_upgrade(plain_password, hashed_password)
    return valid


@lru_cache(maxsize=1)
def dummy_password_hash() -> str:
    """One cost-12 verifier for unknown accounts; no operator credential involved."""
    return hash_password(secrets.token_urlsafe(32))


def create_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def verify_csrf_token(expected: str, provided: str) -> bool:
    return bool(expected and provided and hmac.compare_digest(expected, provided))


def parse_expiration_delta(expires_in: str) -> datetime.timedelta:
    """Parses expiration strings like '7d', '24h', '30m' into a timedelta."""
    expires_in = expires_in.strip().lower()
    if expires_in.endswith("d"):
        return datetime.timedelta(days=int(expires_in[:-1]))
    elif expires_in.endswith("h"):
        return datetime.timedelta(hours=int(expires_in[:-1]))
    elif expires_in.endswith("m"):
        return datetime.timedelta(minutes=int(expires_in[:-1]))
    elif expires_in.endswith("s"):
        return datetime.timedelta(seconds=int(expires_in[:-1]))
    return datetime.timedelta(days=7)


def create_access_token(data: Dict[str, Any], expires_delta: Optional[datetime.timedelta] = None) -> str:
    """Generates a signed JWT token."""
    to_encode = data.copy()
    now = datetime.datetime.now(datetime.timezone.utc)
    
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + parse_expiration_delta(settings.JWT_EXPIRES_IN)
        
    to_encode.update({"iat": now, "exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET, algorithm="HS256")
    return encoded_jwt


def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """Decodes and validates a JWT token."""
    if not isinstance(token, str) or len(token) > 8192:
        return None
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"],
                             options={"require": ["exp", "iat", "id"]})
        if not isinstance(payload.get("id"), str) or not 0 < len(payload["id"]) <= 191:
            return None
        if type(payload.get("ver", 0)) is not int or payload.get("ver", 0) < 0:
            return None
        return payload
    except (jwt.PyJWTError, TypeError, ValueError, RecursionError):
        return None
