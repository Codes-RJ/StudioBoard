import asyncio
import subprocess
import sys

import pytest

from app.core.storage_leases import storage_account_lease, storage_artifact_lease, try_storage_artifact_lease


def _child_can_acquire(root, artifact):
    result = subprocess.run(
        [sys.executable, "-c", "from pathlib import Path; import sys; "
         "from app.core.storage_leases import try_storage_artifact_lease; "
         "lease = try_storage_artifact_lease(Path(sys.argv[1]), Path(sys.argv[2])); "
         "print(lease.__enter__()); lease.__exit__(None, None, None)", str(root), str(artifact)],
        check=True, capture_output=True, text=True, timeout=15,
    )
    return result.stdout.strip() == "True"


def test_other_process_cannot_reclaim_staging_or_promoted_file_until_release(tmp_path):
    target = tmp_path / "upload.csv"
    with try_storage_artifact_lease(tmp_path, target) as acquired:
        assert acquired
        assert not _child_can_acquire(tmp_path, tmp_path / "upload.csv.part")
        assert not _child_can_acquire(tmp_path, target)
    assert _child_can_acquire(tmp_path, target)


@pytest.mark.asyncio
async def test_cancelled_waiter_does_not_release_the_active_writer_or_leak_its_handle(tmp_path):
    target = tmp_path / "upload.csv"

    async def waiting_writer():
        async with storage_artifact_lease(tmp_path, target):
            pytest.fail("An active writer must retain its lease")

    with try_storage_artifact_lease(tmp_path, target) as acquired:
        assert acquired
        waiter = asyncio.create_task(waiting_writer())
        await asyncio.sleep(0.02)
        waiter.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiter
        assert not _child_can_acquire(tmp_path, target)
    assert _child_can_acquire(tmp_path, target)


async def test_account_admission_excludes_another_process_and_releases_on_exit(tmp_path):
    code = """
import asyncio, sys
from pathlib import Path
from app.core.storage_leases import storage_account_lease
async def check():
    try:
        async with asyncio.timeout(0.1):
            async with storage_account_lease(Path(sys.argv[1]), 'fixture-account'):
                return True
    except TimeoutError:
        return False
print(asyncio.run(check()))
"""
    def child_can_enter():
        result = subprocess.run([sys.executable, "-c", code, str(tmp_path)], check=True, capture_output=True, text=True, timeout=15)
        return result.stdout.strip() == "True"
    async with storage_account_lease(tmp_path, "fixture-account"):
        assert not await asyncio.to_thread(child_can_enter)
        async with storage_artifact_lease(tmp_path, tmp_path / "fixture.csv"):
            assert not await asyncio.to_thread(child_can_enter)
    assert await asyncio.to_thread(child_can_enter)
