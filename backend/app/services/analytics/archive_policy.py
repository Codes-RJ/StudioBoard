"""Bound both declared and actually decompressed XLSX bytes before parsing."""
import zipfile
from fastapi import HTTPException

MAX_EXPANDED_BYTES = 200 * 1024 * 1024
MAX_ENTRIES = 10_000


def validate_workbook_archive(path, max_bytes=MAX_EXPANDED_BYTES):
    if not zipfile.is_zipfile(path):
        raise HTTPException(status_code=400, detail="Invalid XLSX archive")
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_ENTRIES or sum(entry.file_size for entry in entries) > max_bytes:
                raise HTTPException(status_code=413, detail="Expanded workbook exceeds archive safety policy")
            total = 0
            for entry in entries:
                if entry.flag_bits & 1:
                    raise HTTPException(status_code=400, detail="Encrypted workbooks are unsupported")
                with archive.open(entry) as content:
                    while chunk := content.read(1024 * 1024):
                        total += len(chunk)
                        if total > max_bytes:
                            raise HTTPException(status_code=413, detail="Expanded workbook exceeds archive safety policy")
    except (zipfile.BadZipFile, RuntimeError, EOFError, NotImplementedError) as exc:
        raise HTTPException(status_code=400, detail="Invalid or unsupported XLSX archive") from exc
