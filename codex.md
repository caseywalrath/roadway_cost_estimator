# Codex Project Guide

## User Context

The user is not a developer, coder, or software engineer.

The user has a remedial understanding of GitHub and Codex.

The user previously used Claude Code through a web/cloud workflow and is now adopting a local Codex workflow.

Codex must not assume the user is operating a traditional terminal workflow unless the user explicitly says so.

Codex should perform routine local development, Git inspection, file editing, testing, committing, and pushing when possible.

Codex should ask the user to manually run terminal commands only when there is a specific blocker.

## Communication Requirements

Use literal, direct, non-empathic, and highly structured language.

Explain what is happening and why in plain English.

When giving instructions to the user, distinguish between:

1. What Codex will do.
2. What the user must do.
3. Why the step is necessary.
4. What result to expect.

Do not provide unexplained command lists.

Do not ask the user to run terminal commands manually unless necessary.

## Terminal And Git Command Policy

Codex should run safe commands itself from the workspace whenever possible.

Examples of commands Codex should usually run:

```text
git status
git branch
git checkout -b branch-name
git add
git commit
git log
git diff
git remote -v
```

Codex may need user approval, authentication, or manual action for:

```text
git pull
git push
gh auth login
gh pr create
```

Codex must be cautious and explicit before using:

```text
git reset
git clean
git rebase
git push --force
```

If Codex cannot run a command itself, Codex must explain:

1. The exact command that needs to run.
2. Why Codex cannot run it.
3. Whether the blocker is authentication, permission, safety, or missing local setup.
4. The exact manual action required from the user.

Preferred user-facing response when terminal commands are suggested unnecessarily:

```text
I am not using a separate terminal workflow unless absolutely necessary.

Please run the command yourself from the workspace.

If you cannot, explain the blocker in plain English and ask for the specific approval or manual action needed.
```

## Known Local Environment Lessons

This project is stored inside a OneDrive-synced folder.

OneDrive and Windows file permissions can interfere with Git metadata writes inside the `.git` folder.

Symptoms may include errors involving:

```text
.git/config.lock
.git/index.lock
.git/refs/heads/[branch-name].lock
Permission denied
could not lock config file
Unable to create index.lock
```

These errors do not necessarily mean the project files are broken.

They usually mean Git could not write temporary lock files inside `.git`.

Codex should handle this as follows:

1. Explain that the blocker is local Git metadata permissions.
2. Retry the same Git operation with the proper Codex approval request when appropriate.
3. Avoid asking the user to run the command manually unless approval-based retry fails.
4. Inspect the Git state after the retry.
5. Avoid broad process-kill or destructive cleanup commands.

If a stale Git lock file exists after a failed Git command, Codex may remove only the specific stale lock file after confirming it is safe.

Codex must not remove the full `.git` folder unless the user explicitly requests a full Git reinitialization and understands the consequence.

Node.js is available through a portable ZIP install, not a standard system install.

Known working path:

```text
C:\Users\Casey.Walrath\Tools\node
```

Known working commands should call Node or npm from that folder:

```text
C:\Users\Casey.Walrath\Tools\node\node.exe
C:\Users\Casey.Walrath\Tools\node\npm.cmd
```

When running npm scripts, Codex may need to prefix `PATH` so scripts resolve to portable Node instead of the Codex desktop bundled Node:

```text
$env:PATH='C:\Users\Casey.Walrath\Tools\node;' + $env:PATH
```

If this is not done, symptoms may include:

```text
Access is denied
spawn EPERM
```

Vite builds may fail locally when OneDrive locks existing output files in `dist`.

Symptoms may include:

```text
EPERM, Permission denied: ...\dist\data
EBUSY: resource busy or locked
```

For verification, Codex may build to a temporary output folder instead of `dist`:

```text
C:\Users\Casey.Walrath\Tools\node\node.exe .\node_modules\vite\bin\vite.js build --outDir dist-check
```

After verification, remove only the specific temporary build folder after checking that the resolved path is inside the workspace.

The GitHub CLI may not be installed or may not respond in this environment.

If `gh` is unavailable, Codex should still use local Git for branch, commit, and push operations when possible, then provide the direct GitHub pull request URL:

```text
https://github.com/caseywalrath/roadway_cost_estimator/pull/new/[branch-name]
```

Browser automation through the in-app browser may fail because the Node REPL reports local Node access errors. If that happens, Codex should use source inspection, local HTTP checks, and user visual confirmation rather than claiming browser automation verification occurred.

Local remote-tracking refs can be stale even when GitHub web already shows newer files on `main`.

Symptoms may include:

```text
GitHub web shows a file on main.
Local `git ls-tree origin/main` does not show the file.
Local `git status` reports the branch is behind or appears inconsistent with GitHub web.
```

Codex should handle this as follows:

1. Run `git fetch --all --prune` before concluding that a file is missing from GitHub.
2. Compare the local `origin/main` commit with the GitHub web commit shown in the browser when the user provides a screenshot or commit reference.
3. If a feature branch was created from stale `origin/main`, fast-forward or recreate it from current `origin/main` before making source changes.
4. If an untracked local copy of a file duplicates a newly fetched tracked file, verify matching content before deleting the duplicate.
5. Explain the stale-ref issue plainly so the user does not mistake it for conflicting project versions.

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
3. Check git status.
4. Confirm the current branch.
5. Create a new branch for this session named [branch-name].
6. Then implement the requested change.

This session goal is:
[describe the change, bug fix, or revision round]
```

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

## Local Testing Workflow

Before committing, Codex should run the most relevant local check available.

For a static web app, this may include:

1. Opening or serving `index.html`.
2. Starting a local development server.
3. Checking that the page loads.
4. Checking that the changed user interface works.
5. Checking for obvious console or runtime errors when possible.

Codex should give the user the local URL when a local server is running.

Example local URLs:

```text
http://localhost:3000
http://localhost:5173
http://127.0.0.1:5500
```

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

This file, `codex.md`, contains workflow, user context, and Codex operating rules.

The project may later use a separate `architecture_overview.md` file for application architecture.

If `architecture_overview.md` exists, Codex must review it before making session plans or code changes.

If architecture, file structure, deployment behavior, data flow, or major app behavior changes, Codex should update the relevant documentation.

Minor copy edits, small visual tweaks, and narrow bug fixes do not require architecture documentation updates unless they change how the app works.

## Session Closeout Checklist

Before closing a session, Codex should:

1. Check git status.
2. Summarize changed files.
3. Confirm whether `codex.md` or `architecture_overview.md` needs updates.
4. Run the relevant local test or preview.
5. Commit the work if requested or appropriate.
6. Push the branch if requested and possible.
7. Tell the user the next manual GitHub step, if any.

## Current Documentation State

This repository contains `architecture_overview.md`.

Codex must review `architecture_overview.md` before new session plans or code changes.

Codex should update `architecture_overview.md` when architecture, file structure, deployment behavior, data flow, or major app behavior changes.

Current product documentation also includes:

```text
docs/data_schema.md
docs/implementation_notes.md
project_roadmap.md
user_workflow.md
```
