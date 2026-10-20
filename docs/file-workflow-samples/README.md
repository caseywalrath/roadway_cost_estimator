# File workflow CSV samples

These files are user-approved illustrative layouts for the simplified human-facing CSV contracts in File-B of `docs/planning-engineering-qol-file-workflows-plan.md`.

The rows and values are synthetic. They were reviewed before existing exporter columns were removed. Spreadsheet workflows that consume the former headers may need to update their mappings.

- `project.csv` uses the Project screen column order and includes the visible project cost summary.
- `matching-projects.csv` uses the visible Matching Projects columns, including Colorado-only District and Engineer Estimate fields.
- `nebraska-price-history.csv` uses the eight visible Nebraska price-history columns.
- `planning.csv` keeps project context, visible element rows, and visible summary totals; it omits Pay item detail.

All samples use CRLF row endings. `planning.csv` also uses the existing UTF-8 BOM convention. Text that could be interpreted as a spreadsheet formula is apostrophe-prefixed in the samples.

The approved choices are a Project and Planning context preamble, the stable `Published Average Unit Price` Nebraska header, the compact six-column Planning table, and visible source labels without hidden source URLs.
