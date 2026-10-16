import pytest
from sqlalchemy.engine import make_url

from app.core.config import normalize_database_url


@pytest.mark.parametrize("scheme", ["mysql", "mysql+pymysql", "mysql+aiomysql"])
@pytest.mark.parametrize("password,expected", [
    ("fixture pass+word", "fixture pass+word"),
    ("fixture%20pass%2Bword", "fixture pass+word"),
    ("fixture@:/?#&=+!word", "fixture@:/?#&=+!word"),
    ("fixture%2520word", "fixture%20word"),
    ("fixture%25word", "fixture%word"),
])
def test_mysql_password_round_trips_without_form_encoding(scheme, password, expected):
    normalized = normalize_database_url(f"{scheme}://fixture-user:{password}@localhost:3307/fixture-db")
    parsed = make_url(normalized)
    assert parsed.drivername == "mysql+aiomysql"
    assert parsed.username == "fixture-user"
    assert parsed.password == expected
    assert parsed.host == "localhost"
    assert parsed.port == 3307
    assert parsed.database == "fixture-db"
    assert normalize_database_url(normalized) == normalized


def test_non_mysql_url_is_unchanged():
    url = "sqlite+aiosqlite:///fixture.db"
    assert normalize_database_url(url) == url
