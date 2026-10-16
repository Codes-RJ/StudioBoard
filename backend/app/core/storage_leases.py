"""Cross-process artifact leases on the shared upload filesystem.

Fixed lock stripes avoid a growing lock-file catalogue. Never remove a stripe:
replacing its inode would allow two processes to believe they own the same lock.
"""

import asyncio
import errno
import hashlib
import os
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path

if os.name == "nt":
    import msvcrt
else:
    import fcntl

LOCK_DIRECTORY = ".storage-locks"


class _ArtifactLease:
    def __init__(self, upload_directory: Path, artifact: Path, namespace: str = ""):
        root = Path(upload_directory).resolve()
        artifact = Path(artifact).resolve()
        artifact.relative_to(root)  # Reject paths outside this upload volume.
        if artifact.name.endswith(".part"):
            artifact = artifact.with_name(artifact.name[:-5])
        digest = hashlib.sha256(os.path.normcase(str(artifact.relative_to(root))).encode("utf-8")).digest()
        lock_directory = root / LOCK_DIRECTORY
        if namespace:
            lock_directory = lock_directory / namespace
        lock_directory.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(lock_directory / f"{digest[0]:02x}.lock", os.O_CREAT | os.O_RDWR, 0o600)
        self.file = os.fdopen(descriptor, "r+b")
        if os.fstat(descriptor).st_size == 0:
            self.file.write(b"\0")  # Windows byte-range locking needs a byte.
            self.file.flush()
        self.acquired = False

    def try_acquire(self) -> bool:
        if self.acquired:
            return True
        self.file.seek(0)
        try:
            if os.name == "nt":
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            if error.errno not in {errno.EACCES, errno.EAGAIN, errno.EDEADLK}:
                raise
            return False
        self.acquired = True
        return True

    def close(self) -> None:
        try:
            if self.acquired:
                self.file.seek(0)
                if os.name == "nt":
                    msvcrt.locking(self.file.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(self.file.fileno(), fcntl.LOCK_UN)
        finally:
            self.file.close()


@asynccontextmanager
async def storage_artifact_lease(upload_directory: Path, artifact: Path):
    """Hold from before writing staging bytes until ownership commits or fails."""
    lease = _ArtifactLease(upload_directory, artifact)
    try:
        while not lease.try_acquire():
            await asyncio.sleep(0.05)
        yield
    finally:
        lease.close()


@contextmanager
def try_storage_artifact_lease(upload_directory: Path, artifact: Path):
    """Maintenance skips active stripes instead of waiting on slow uploads."""
    lease = _ArtifactLease(upload_directory, artifact)
    try:
        yield lease.try_acquire()
    finally:
        lease.close()


@asynccontextmanager
async def storage_account_lease(upload_directory: Path, user_id: str):
    """Serialize quota admission through commit across API processes.

    Use a separate stripe namespace so nested artifact locking cannot collide
    with this lease and deadlock the owning upload.
    """
    root = Path(upload_directory).resolve()
    key = hashlib.sha256(user_id.encode("utf-8")).hexdigest()
    lease = _ArtifactLease(root, root / f"account-{key}", namespace="accounts")
    try:
        while not lease.try_acquire():
            await asyncio.sleep(0.05)
        yield
    finally:
        lease.close()
