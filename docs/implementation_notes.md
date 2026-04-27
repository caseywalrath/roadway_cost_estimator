# Implementation Notes

## Current Scope

The first implementation is the Colorado Roadway Comparable Project Explorer.

Included:

- Static Vite + TypeScript app.
- Demo CSV data package.
- One-item lookup form.
- Deterministic browser-side matching.
- Recommendation summary.
- Price distribution summary.
- Top comparable records table.
- Warnings and improve-confidence guidance.

Not included:

- Real estimating data.
- Estimate upload.
- Estimate workspace.
- User accounts.
- Server or hosted database.
- Chat layer.
- Automatic PDF or spreadsheet parsing.

## Local Commands

Install dependencies:

```text
npm install
```

Run a local development server:

```text
npm run dev
```

If Node.js is installed as a portable ZIP, run npm through the extracted folder:

```text
C:\Users\Casey.Walrath\Tools\node\npm.cmd run dev
```

Build the static site:

```text
npm run build
```

If using portable Node:

```text
C:\Users\Casey.Walrath\Tools\node\npm.cmd run build
```

Preview the production build:

```text
npm run preview
```

## GitHub Pages

The Vite config uses `base: "./"` so the built app can run from a GitHub Pages project path.

Expected deployment artifact:

```text
dist/
```

The likely production flow is:

1. Build the app.
2. Publish `dist` through GitHub Pages.
3. Keep source files on a feature branch until reviewed and merged.

The repository includes `.github/workflows/pages.yml` for GitHub Pages deployment from `main`.
The workflow uses `npm ci` so GitHub builds from the committed lockfile.

## Next Product Steps

1. Collect public CDOT source files or links.
2. Define import scripts for those source formats.
3. Validate 5 to 10 common roadway item families with roadway reviewers.
4. Replace or supplement demo data with validated public records.
5. Add a lightweight estimate workspace after item matching is trusted.
