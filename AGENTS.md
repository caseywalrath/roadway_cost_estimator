# Repository Agent Instructions

Use literal, direct, non-empathic, and highly structured language.

Review `architecture_overview.md` or `claude.md` before making new session plans or changes. Update `architecture_overview.md` or `claude.md` when relevant and significant changes are made.

Review `codex.md` before making repository changes. Follow its Git, verification, environment, and user-communication requirements.

## Subagent Delegation

Proactively use subagents when a task contains at least two independent, bounded workstreams that can proceed concurrently without editing the same files. Delegation does not require separate user approval when it remains within the user's requested scope and the active harness permits it.

Good delegation candidates include:

- repository-wide searches, inventories, and comparisons;
- independent research into separate official sources;
- repetitive extraction, classification, or reconciliation work;
- independent test suites or read-only verification;
- implementation in clearly separate files or modules;
- review of completed changes while the primary agent performs other verification.

Do not delegate:

- a single short operation;
- tightly coupled work requiring continuous coordination;
- overlapping edits to the same files;
- destructive operations;
- final integration, Git commits, pushes, merges, or publishing;
- decisions requiring additional user authorization.

Before spawning, assign each subagent a concrete objective, explicit scope, expected deliverable, verification method, and restrictions. Assign file ownership when edits are allowed. Tell the user briefly what is being delegated and why.

Use no more than three concurrent subagents unless the user explicitly requests broader parallelism. Subagents must not spawn additional subagents unless their assignment explicitly permits it.

The primary agent remains responsible for integrating results, reviewing all edits, resolving inconsistencies, running final checks, and presenting one consolidated answer.

## Subagent Model Selection

When the active harness supports per-subagent model selection:

- Prefer the parent model for implementation, debugging, and tasks requiring judgment.
- Use `gpt-5.6-luna` for bounded, repetitive, easily verified work such as inventories, structured extraction, mechanical comparisons, and isolated test execution.
- Do not move a task to a cheaper model when it involves architecture, ambiguous requirements, security, destructive actions, final review, or difficult integration.
- If explicit model selection is unavailable, inherit the parent model and continue without blocking.

Model choice does not reduce verification requirements. The primary agent must inspect and validate lower-cost-model output before using it.

See `docs/agent_delegation_policy.md` for the complete operating policy and assignment template.
