import zipfile
import pytest
from fastapi import HTTPException
from app.services.analytics.archive_policy import validate_workbook_archive


def test_archive_size_rejection_and_valid_small_archive(tmp_path):
    path = tmp_path / 'fixture.xlsx'
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('xl/worksheets/sheet1.xml', b'A' * 128_000)
    with pytest.raises(HTTPException) as error:
        validate_workbook_archive(path, max_bytes=1024)
    assert error.value.status_code == 413
    validate_workbook_archive(path, max_bytes=256_000)
