# Excel import binary fixtures

The committed workbook fixture is generated with the pinned SheetJS Community
Edition package. From the repository root, run:

```powershell
& 'C:\Users\Casey.Walrath\Tools\node\node.exe' scripts/generate_excel_import_fixtures.mjs
```

`sparse-reader-fixtures.xlsx` contains a leading-zero identifier, a cached
formula, a formula with no cached value, a cached formula error, a hidden row,
a hidden worksheet, a horizontal merge, a vertical merge, number formats, and a
print-area defined name. It is intentionally small and contains no project or
agency data.
