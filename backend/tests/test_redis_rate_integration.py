"""Opt-in live Redis proof. Only this run's unique key is created/deleted."""
import os
import subprocess
import sys
import uuid
import pytest
from limits import parse
from limits.storage import storage_from_string

URI = os.environ.get('REDIS_INTEGRATION_STORAGE_URL')


@pytest.mark.skipif(not URI, reason='Requires explicitly configured disposable Redis integration service')
def test_independent_processes_share_one_rate_budget():
    identity = 'fixture-' + uuid.uuid4().hex
    scope = 'redis-process-integration'
    script = '''
import os, sys
from limits import parse
from limits.storage import storage_from_string
from limits.strategies import FixedWindowRateLimiter
storage = storage_from_string(os.environ['REDIS_INTEGRATION_STORAGE_URL'], socket_timeout=2, socket_connect_timeout=2)
print(int(FixedWindowRateLimiter(storage).hit(parse('2/minute'), sys.argv[1], sys.argv[2])))
'''
    storage = storage_from_string(URI, socket_timeout=2, socket_connect_timeout=2)
    try:
        outcomes = [subprocess.check_output([sys.executable, '-c', script, identity, scope], text=True, timeout=10).strip()
                    for _ in range(3)]
        assert outcomes == ['1', '1', '0']
    finally:
        storage.clear(parse('2/minute').key_for(identity, scope))
