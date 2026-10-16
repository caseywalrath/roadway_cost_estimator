# File workflow CSV samples

These files are illustrative proposals for the simplified human-facing CSV contracts in File-B of `docs/planning-engineering-qol-file-workflows-plan.md`.

The rows and values are synthetic. They are provided for engineer review before existing exporter columns are removed or spreadsheet workflows are migrated.

- `project.csv` uses the Project screen column order and includes the visible project cost summary.
- `matching-projects.csv` uses the visible Matching Projects columns, including Colorado-only District and Engineer Estimate fields.
- `nebraska-price-history.csv` uses the eight visible Nebraska price-history columns.
- `planning.csv` keeps project context, visible element rows, and visible summary totals; it omits Pay item detail.

All samples use CRLF row endings. `planning.csv` also uses the existing UTF-8 BOM convention. Text that could be interpreted as a spreadsheet formula is apostrophe-prefixed in the samples.

Review open choices before implementation:

1. Confirm whether project context belongs in a Field/Value preamble or should remain on each line.
2. Confirm whether the Nebraska average-price header should follow the state-configured screen label or use the stable `Published Average Unit Price` name.
3. Confirm whether Planning should adopt the compact six-column table shown here or retain the current 11-column table with blank non-applicable cells.
4. Confirm whether a visible source label is sufficient for Matching Projects and Nebraska history, or whether a visible source URL should be included.
