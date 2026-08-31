# Agent Delegation Policy

## Purpose

This policy defines when the primary coding agent should divide repository work among subagents. Its objective is to reduce elapsed time and model cost while preserving clear ownership, review, and verification.

`AGENTS.md` contains the enforceable summary. This document provides the detailed operating procedure. Harness, permission, security, and system-level instructions always take precedence over repository instructions.

## Delegation Decision

At the start of a substantial task, identify whether it contains independent workstreams. Delegate when all of the following are true:

1. At least two useful tasks can proceed independently.
2. Each delegated task has a concrete completion condition.
3. File ownership can be separated, or the delegated task can remain read-only.
4. The expected time saved exceeds the coordination and review cost.
5. The primary agent can objectively inspect or test the result.

Do not create subagents merely because they are available. Small documentation edits, single-file fixes, short explanations, and sequential debugging usually remain with the primary agent.

## Preferred Work Types

### Read-only discovery

Suitable examples:

- inventory files, routes, data sources, or tests;
- locate references to a symbol or feature;
- compare separate state data packages;
- inspect independent external sources;
- summarize a bounded document set.

Read-only discovery is the lowest-conflict delegation type and should be preferred when parallel investigation will inform primary-agent work.

### Repetitive or mechanical work

Suitable examples:

- classify records using explicit rules;
- extract the same fields from multiple files;
- compare generated outputs against a fixed checklist;
- run separate test suites and report failures;
- check documentation links or repeated schema fields.

Use a lower-cost model only when the instructions and acceptance criteria are explicit and the result can be checked objectively.

### Independent implementation

Implementation may be delegated when file boundaries are unambiguous. Each agent must receive exclusive ownership of its assigned files for the duration of the task. The primary agent owns shared interfaces, integration files, and final conflict resolution.

Avoid simultaneous edits to central files such as manifests, shared schemas, global stylesheets, lockfiles, and architecture documents unless one agent has exclusive ownership.

### Independent review

A subagent may review a completed implementation for defects, missing tests, or requirement gaps. Review assignments should normally be read-only. The primary agent decides which findings to accept and performs any resulting integration work.

## Work That Remains With the Primary Agent

The primary agent retains responsibility for:

- interpreting the complete user request;
- deciding the overall approach and architecture;
- requesting any additional authority from the user;
- assigning non-overlapping work;
- integrating and reviewing all returned results;
- resolving conflicts and uncertain conclusions;
- running final repository-level verification;
- making Git commits, pushes, merges, and publication changes;
- reporting the completed result to the user.

Subagent output is evidence or a proposed change, not an automatically accepted result.

## Model Routing

Use model routing only when the harness exposes per-subagent model selection.

| Work type | Preferred model behavior |
| --- | --- |
| Repetitive extraction, inventory, classification, or isolated test execution | Use `gpt-5.6-luna` when the output is easily verified. |
| Ordinary implementation, debugging, and repository analysis | Inherit the parent model. |
| Architecture, ambiguous requirements, security, destructive work, and final review | Keep with the primary agent; do not downgrade automatically. |

Examples of appropriate Luna assignments:

- inventory every Markdown file matching fixed criteria;
- extract URL, title, and publication date from a defined list of sources;
- compare two generated CSV schemas and enumerate differences;
- run a named test suite and return the exact failures;
- check a list of files against a fixed formatting checklist.

Examples that should not be downgraded automatically:

- determine whether two agency item identities are genuinely equivalent;
- redesign the application data architecture;
- resolve ambiguous parsing or provenance evidence;
- modify permissions, authentication, deployment, or destructive workflows;
- approve a completed import for publication.

If the harness cannot select a different model, the subagent inherits the parent model. Continue the task rather than treating model routing as a requirement.

## Assignment Contract

Every subagent assignment must state:

```markdown
Task:
[One concrete objective.]

Scope:
[Files, directories, sources, or systems included. State whether work is read-only.]

Deliverable:
[Exact result expected: table, findings, patch, test report, or recommendation.]

Verification:
[Checks the subagent must perform or evidence it must provide.]

Restrictions:
[Files not to edit, prohibited external actions, Git restrictions, and whether further delegation is allowed.]
```

Example:

```markdown
Task:
Inventory Markdown files that describe data-import workflows.

Scope:
Read-only inspection of repository Markdown files.

Deliverable:
Return a table containing file path, purpose, overlap, and archival recommendation.

Verification:
Include the search terms used and identify uncertain recommendations.

Restrictions:
Do not edit files, change Git state, download sources, or spawn additional agents.
```

## Coordination Rules

- Keep assignments independent and bounded.
- Prefer two focused subagents over several narrowly fragmented assignments.
- Limit normal concurrency to three subagents.
- Do not assign the same file to multiple editing agents.
- Do not let subagents commit, push, merge, publish, or modify repository history.
- Continue useful primary-agent work while subagents run.
- Stop or redirect work that becomes redundant or leaves its assigned scope.
- Do not conceal disagreements between agents; resolve them using repository evidence and tests.
- Treat failures, uncertainty, and incomplete results as explicit findings.

## Integration and Verification

After delegated work returns, the primary agent must:

1. Inspect each result against its assignment.
2. Review every proposed file change.
3. Reconcile conflicting findings.
4. Confirm that no unrelated user changes were overwritten.
5. Run the checks required by `codex.md` for the combined change.
6. Present one consolidated result rather than separate agent transcripts.

Delegation changes who performs intermediate work. It does not change the repository's validation, documentation, safety, or approval requirements.

## User Communication

When delegation begins, provide one short update naming the delegated workstreams and why they can run independently. Do not require the user to coordinate subagents. Report only information needed to understand the final result, material uncertainty, or a required user decision.

## Failure Handling

If a subagent fails or produces unusable work:

1. Determine whether the assignment was unclear, unsupported, or technically blocked.
2. Refine and retry once when the correction is narrow and worthwhile.
3. Complete the work with the primary agent when another delegation would cost more than it saves.
4. Ask the user only when progress requires new information, authority, or a material scope decision.
