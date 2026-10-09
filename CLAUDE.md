# Claude Project Guide

This file adapts `AGENTS.md` and `codex.md` for Claude Code sessions. Where they conflict, this file applies to Claude sessions; `codex.md` remains the guide for local Codex sessions.

## User context and communication

- The user is not a developer. Perform routine Git, editing, testing, committing, and pushing without asking the user to run commands.
- Use literal, direct, non-empathic, structured language. Explain what happened and why in plain English.
- Do not end a turn with offers or questions unless the user asks for them.
- Do not open a pull request unless the user asks.

## Session start

1. Read this file, `architecture_overview.md`, and any active plan in `docs/` (currently `docs/planning-v2-implementation-plan.md`).
2. `git fetch origin <branch>` and `git status -sb`. Work on the branch named in the active plan or session instructions.
3. Run `npm ci` if `node_modules` is missing.

## Commands (cloud container, Linux)

| Need | Command |
|---|---|
| Install | `npm ci` |
| Typecheck | `node ./node_modules/typescript/bin/tsc` |
| Web tests | `npx vitest run` (or one file: `npx vitest run src/path/file.test.ts`) |
| Python tests | `npm test` (runs `python -m unittest` over `scripts/test_*.py` listed in `package.json`); single file: `python -m unittest scripts/test_x.py` |
| Data validation | `python scripts/validate_data_package.py` |
| Production build | `node ./node_modules/vite/bin/vite.js build --outDir dist-check` |
| Dev server for screenshots | `node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173` (run in background) |
| Screenshots | Playwright with the preinstalled Chromium (`/opt/pw-browsers`); do not run `playwright install` |

The Windows/OneDrive workarounds in `codex.md` do not apply to the cloud container.

## Environment notes

- `xlsx` installs from `cdn.sheetjs.com`. The environment network policy must allow that host; if `npm ci` fails with 403, check the policy before anything else.
- Generated folders `dist-check/` and `__pycache__/` are gitignored.

## Verification by change type

| Change | Required check |
|---|---|
| Docs only | Proofread |
| Python script or data generator | The script's unit tests; `validate_data_package.py` if `public/data` changed |
| TypeScript logic | Typecheck and the affected vitest files; full `npx vitest run` before a stop point |
| UI / CSS | Typecheck, vitest, build, and desktop (1440 px) plus narrow (390 px) screenshots reviewed by the orchestrator |

## UI conventions

New UI reuses the shared classes and `:root` color tokens in `src/styles.css` (`panel-block`, `panel-heading`, `eyebrow`, `primary-button`, `secondary-button`, `text-button`, `muted`, `label-row`, `table-scroll`, `summary-table`). No hard-coded hex colors and no blanket element rules scoped to a module container. Module-specific classes are limited to layout and to parts with no shared equivalent.

## Subagents and model routing

The primary session is the orchestrator. It owns plans, shared types, integration, review of all delegated work, final checks, and all Git operations.

| Model | Use for |
|---|---|
| Opus | Cost-method derivation, data judgment, architecture, UI layout design, adversarial review |
| Sonnet | Implementation from a written specification: UI wiring, scripts, tests |
| Haiku | High-volume bounded work: inventories, fixture tables, regression runs, mechanical comparisons |

Rules:

- At most three concurrent subagents.
- Each assignment states objective, exclusive file ownership, deliverable, verification method, and restrictions.
- Subagents do not commit, push, open pull requests, spawn agents, or edit files outside their ownership.
- The orchestrator inspects every edit and every numeric output before using it.
- Do not delegate a single short operation, tightly coupled work, destructive operations, or Git.

## Git

- Commit messages describe the completed change.
- Push with `git push -u origin <branch>`; retry network failures with backoff.
- No force push, `reset --hard`, or history rewrite without explicit user approval.
- At each plan stop point: update the plan's completion log, commit, and push.

## Documentation

Update `architecture_overview.md`, `docs/data_schema.md`, `docs/implementation_notes.md`, and `user_workflow.md` when architecture, data flow, or major behavior changes.
