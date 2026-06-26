# Codex Project Guide

## User Context

The user is not a developer, coder, or software engineer.

The user has a basic but functional understanding of GitHub and Codex.

The user previously used Claude Code through a web/cloud workflow and is now adopting a local Codex workflow.

Codex must not assume the user is operating a traditional terminal workflow unless the user explicitly says so.

Codex should perform routine local development, Git inspection, file editing, testing, committing, and pushing when possible.

Codex should ask the user to manually run terminal commands only when there is a specific blocker.

## Communication Requirements

Use literal, direct, non-empathic, and highly structured language. Explain what is happening and why in plain English.

When giving the user instructions, distinguish: (1) what Codex will do, (2) what the user must do, (3) why the step is necessary, (4) what result to expect. Do not provide unexplained command lists.

## Canonical Local Commands

This repo runs in a OneDrive-synced folder with portable Node, inside the Codex sandbox. That
combination causes the **same failures almost every session**. The commands below already bake
in the known workaround — **use them as the default, do not attempt the naive form first, watch
it fail, then retry.** This is the single biggest source of wasted turns.

Portable Node lives at `C:\Users\Casey.Walrath\Tools\node`. Call Node and the local package
binaries directly; do not rely on `npm` / `node` being on PATH (they often are not), and do not
use `npm run` for verification.

| Need | Use this directly | Why / what it avoids |
|---|---|---|
| Typecheck (default code check) | `node ./node_modules/typescript/bin/tsc` | `tsconfig` sets `noEmit`, so this is a full typecheck that writes nothing — fast, never touches `dist`, never hits the OneDrive lock |
| Production build (only when bundle matters) | `node ./node_modules/vite/bin/vite.js build --outDir dist-check --configLoader native` | `--outDir dist-check` avoids the OneDrive `dist` lock; `--configLoader native` avoids the `require is not defined` config-load failure. Run it **with escalation** — `spawn EPERM` is expected without it |
| Local UI preview (only for visual checks) | serve built `dist-check` as a static server on `http://127.0.0.1:4174/` | `npm run dev` / `Start-Process` is unstable here (PATH-duplication, port never binds). The static preview on :4174 is the method that works |
| Data validation | `python scripts/validate_data_package.py` | — |

### Git writes (fetch / branch / add / commit / push)

On this OneDrive repo, Git writes **will** fail to create lock files inside `.git` on the first
unprivileged attempt (`.git/index.lock`, `.git/config.lock`, `.git/FETCH_HEAD`,
`could not lock`, `Permission denied`). This is a metadata-permission issue, not a broken repo.

**Request approval/escalation on the first attempt** rather than running unprivileged, observing
the lock error, and retrying. `git push` additionally needs network approval in the sandbox —
expect that on the first push too.

If a write still fails after the escalated attempt, a *specific* stale lock file (e.g.
`.git/index.lock`) may be removed after confirming it is safe. Never remove the full `.git`
folder unless the user explicitly requests reinitialization and understands the consequence.
Avoid broad process-kill or destructive cleanup.

### Pull requests

`gh` is **not available** in this environment — do not spend a turn re-checking for it. Use the
GitHub connector directly for PR creation. If the connector is also unavailable, push the branch
and give the user the direct URL: `https://github.com/caseywalrath/roadway_cost_estimator/pull/new/[branch-name]`.

### Generated folders

`dist-check/` and `__pycache__/` are gitignored. **Leave them in place** — OneDrive denies
deletion, and there is no reason to delete them. Do not retry cleanup of these folders.

### Browser automation

The in-app browser is unreliable here and **cannot perform file downloads at all** — never
attempt download-event verification. When the browser runtime fails to initialize, fall back to
source inspection and direct CSV/DOM data checks rather than claiming browser verification
occurred. Reserve browser checks for genuine UI/visual changes (see Verification by Change Type).

### Stale remote-tracking refs

Local `origin/main` can lag what GitHub web shows. Always `git fetch --all --prune` before
concluding a file is missing or before branching, so feature branches start from current
`origin/main`. If a branch was created from stale `origin/main`, recreate or fast-forward it
from current `origin/main` before making source changes. If an untracked local file duplicates a
newly fetched tracked file, verify matching content before deleting the duplicate.

### Caution before destructive Git

Be explicit and confirm before `git reset`, `git clean`, `git rebase`, or `git push --force`.
Force push is not used for this project unless the user explicitly requests overwriting history.

## First Push And Existing Remote History

When pushing to GitHub for the first time, the remote repository may already contain files.

Common examples:

```text
README.md
.gitignore
LICENSE
test files created through the GitHub web interface
```

If `git push` is rejected with a message such as `fetch first`, Codex should not force push.

Codex should:

1. Fetch the remote history.
2. Inspect the remote files and commit history.
3. Explain that GitHub already contains work that is not local.
4. Merge the remote history into the local branch when appropriate.
5. Push the combined result.

If the local and remote repositories were initialized separately, Git may report unrelated histories.

In that case, Codex may use an unrelated-history merge only after confirming the remote contents are understood and nothing will be overwritten.

Codex should prefer preserving both local and remote files.

Force push should not be used for this project unless the user explicitly requests overwriting GitHub history.

## Session Workflow

Each chat session should correspond to one major change, one bug-fix round, or one revision round.

Each session should usually happen on a new branch.

Recommended session start:

```text
We are working in the roadway_cost_estimator repo.

Before making changes:
1. Review codex.md.
2. Review architecture_overview.md if it exists.
3. Run git fetch --all --prune before trusting local origin/main.
4. Check git status.
5. Confirm the current branch and whether it is behind origin/main.
6. If local main or the current feature branch is behind origin/main, create or recreate the working branch from current origin/main before editing.
7. Create a new branch for this session named [branch-name].
8. Then implement the requested change.

This session goal is:
[describe the change, bug fix, or revision round]
```

Do not implement new source changes on a branch created from stale `origin/main`. If source changes were already made on a stale branch, stash or otherwise isolate only the intended session changes, switch to a fresh branch from current `origin/main`, and replay the session changes file-by-file. Do not apply a stale full-worktree patch over newer repository files.

Good branch names:

```text
setup-initial-app
add-cost-input-form
fix-github-pages-layout
revise-export-feature
```

Avoid vague branch names:

```text
changes
updates
test
final
```

## Branch Policy

The `main` branch should be treated as the stable version.

Feature branches should contain unfinished work, experiments, revisions, and bug fixes.

Use one branch per meaningful unit of work.

Merge back to `main` only after the change has been tested and reviewed.

## Verification By Change Type

Scale verification to the risk of the change. Do **not** run the full build + browser loop for
every change — most changes need far less. Browser verification is **opt-in**, reserved for
UI/visual changes. Use the Canonical Local Commands above for each check.

| Change type | Required check | Skip |
|---|---|---|
| Markdown / docs / comments only | proofread; no command needed | build, validate, browser |
| Python importer / validator / parser | the specific `python -m unittest ...` or script run, plus `validate_data_package.py` if data changed | vite build, browser |
| CSV data only | `python scripts/validate_data_package.py` + a direct row-count check | vite build, browser |
| TypeScript logic, non-visual | `tsc` typecheck | vite build, browser (unless requested) |
| UI / CSS / visual | `tsc`, then vite build to `dist-check`, then optional static preview on :4174 | download-event check (impossible in-app browser) |

When a static preview server is running, give the user the local URL
(`http://127.0.0.1:4174/`).

## Commit And Push Workflow

After local testing is complete, Codex should summarize changed files before committing.

Commit messages should describe the completed change.

Good commit messages:

```text
Add initial app shell
Add pavement cost calculator
Fix mobile layout for estimate form
Update project workflow guide
```

Avoid vague commit messages:

```text
stuff
changes
fix
latest
```

After committing, Codex may push the branch to GitHub if authentication and permissions allow it.

If pushing requires approval or login, Codex must explain the blocker clearly.

## GitHub Pages Workflow

GitHub Pages should usually deploy from `main`.

After a branch is merged into `main`, the user should check GitHub Pages.

Expected process:

1. Open the GitHub repository.
2. Check the pull request or merge result.
3. Open the `Actions` tab if deployment uses GitHub Actions.
4. Wait for the Pages deployment to finish.
5. Open the GitHub Pages URL.
6. Refresh if the site has not updated yet.

Typical GitHub Pages URL format:

```text
https://[username].github.io/[repo-name]/
```

## Project Documentation Policy

`codex.md` holds workflow, user context, and Codex operating rules. The repository also contains `architecture_overview.md` plus `docs/data_schema.md`, `docs/implementation_notes.md`, `project_roadmap.md`, and `user_workflow.md`.

Codex must review `architecture_overview.md` before new session plans or code changes. Update `architecture_overview.md` (and the related docs above) when architecture, file structure, deployment behavior, data flow, or major app behavior changes. Minor copy edits, small visual tweaks, and narrow bug fixes do not require documentation updates unless they change how the app works.

## Session Closeout Checklist

Before closing a session, Codex should:

1. Check git status.
2. Summarize changed files.
3. Confirm whether `codex.md` or `architecture_overview.md` needs updates.
4. Run the relevant local test or preview.
5. Commit the work if requested or appropriate.
6. Push the branch if requested and possible.
7. Tell the user the next manual GitHub step, if any.
