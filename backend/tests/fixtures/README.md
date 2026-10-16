# Analytics input fixtures

`legacy-biff8.xls` is a synthetic Excel 97-2003 (BIFF8/OLE2) workbook with
one sheet named `Data`: columns `identifier,value` and rows `A001,10` and
`A002,20`. It contains no user data, formulas or macros. It was generated
with the repository's existing SheetJS 0.20.3 dependency using
`XLSX.write(book, { type: 'buffer', bookType: 'biff8' })`.

The XLS tests exercise the actual server parser, upload metadata and
analytics route, rather than disguising an XLSX file with an XLS extension.
