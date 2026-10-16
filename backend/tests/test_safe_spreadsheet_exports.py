import csv
import io
import pandas as pd
from openpyxl import load_workbook
from app.services.analytics.strategies.export import ExportStrategy


def test_csv_and_xlsx_escape_headers_and_values_without_mutating_source():
    source = pd.DataFrame({'=header': ['=1+1', ' +SUM(1,2)', '@x', '\ttext'], 'number': [-1, 2, 3, 4],
                           'identifier': ['0001', '0002', '0003', '0004']})
    original = source.copy(deep=True)
    strategy = ExportStrategy()
    csv_output, _, _ = strategy._compute(source, {'format': 'csv'})
    rows = list(csv.reader(io.StringIO(csv_output.getvalue().decode())))
    assert rows[0][0] == "'=header"
    assert all(row[0].startswith("'") for row in rows[1:])
    assert rows[1][1:] == ['-1', '0001']
    xlsx_output, _, _ = strategy._compute(source, {'format': 'xlsx'})
    workbook = load_workbook(xlsx_output)
    assert all(cell.data_type != 'f' for row in workbook.active for cell in row)
    pd.testing.assert_frame_equal(source, original)
    json_output, _, _ = strategy._compute(source, {'format': 'json'})
    assert '=1+1' in json_output.getvalue().decode()
