"""Only explicitly trusted immediate peers may supply forwarding information."""
from ipaddress import ip_address, ip_network
from fastapi import Request
from app.core.config import settings


def trusted_proxy_peer(request: Request) -> bool:
    if not settings.TRUST_PROXY_HEADERS or not request.client:
        return False
    try:
        peer = ip_address(request.client.host)
        return any(peer in ip_network(value.strip(), strict=False)
                   for value in settings.TRUSTED_PROXY_CIDRS.split(",") if value.strip())
    except ValueError:
        return False


def client_identity(request: Request) -> str:
    direct = request.client.host if request.client else "unknown"
    if not trusted_proxy_peer(request):
        return direct
    # The trusted ingress replaces this header with one validated address.
    forwarded = request.headers.get("x-forwarded-for", "").strip()
    try:
        return str(ip_address(forwarded))
    except ValueError:
        return direct  # Reject ambiguous chains rather than trusting their first entry.


def request_is_https(request: Request) -> bool:
    return request.url.scheme == "https" or (
        trusted_proxy_peer(request) and request.headers.get("x-forwarded-proto", "").lower() == "https"
    )
