## Implementation plan for Luna

### Objective

Consolidate `explorer` and `catalog` Project lines into one `catalog` type. Preserve Explorer evidence as optional metadata.

Final model:

```ts
type ProjectLineItemType = "catalog" | "custom";

interface ProjectLineItem {
  lineItemType: ProjectLineItemType;
  evidenceContext: ProjectEvidenceContext | null;
  // existing fields unchanged
}
```

### 1. Update the Project workspace model

File: `src/projects/projectWorkspace.ts`

- Increase `PROJECT_WORKSPACE_SCHEMA_VERSION` from `8` to `9`.
- Change `ProjectWorkspaceState.schemaVersion` to `9`.
- Remove `"explorer"` from `ProjectLineItemType`.
- Make the Item Search line constructor create `lineItemType: "catalog"`.
- Prefer renaming `createProjectLineItem()` to `createCatalogProjectLineItem()` and update its imports/callers.
- Keep `linkProjectLineItemToCatalog()` creating a `catalog` line.
- Permit `evidenceContext` to be either a valid snapshot or `null` for catalog lines.
- Permit nullable quantity and unit cost for every catalog line.
- Keep catalog identity fields locked.
- Keep custom lines free-form and require blank agency identity plus `evidenceContext: null`.
- Simplify construction totals to include `catalog`; other costs continue to include `custom`.

### 2. Add schema-v9 normalization

Files:

- `src/projects/projectWorkspace.ts`
- `src/projects/projectRepository.ts`
- `src/projects/projectBackup.ts`

Add `parseUserProjectV9()` as the current parser.

Migration behavior:

| Stored line | v9 result |
|---|---|
| `explorer` with evidence | `catalog` with evidence preserved |
| `catalog` without evidence | `catalog` without evidence |
| `custom` | `custom` unchanged |
| Legacy missing line type | `catalog` with existing evidence preserved |

Requirements:

- Do not discard queries, filters, sorting, observation IDs, summary snapshots, or `costSource`.
- Do not change line IDs, timestamps, quantities, costs, notes, groups, or catalog identities.
- Continue accepting supported v4–v8 Project backups.
- Export all new backups as schema v9.
- Reject malformed non-null evidence objects when non-null; do not silently replace malformed evidence with `null`.

### 3. Simplify UI branches

Files:

- `src/ui/renderApp.ts`
- `src/ui/renderProjectWorkspace.ts`

Changes:

- Item Search additions create catalog lines with evidence.
- Exact-code Project additions create catalog lines without evidence.
- Remove logic that tests specifically for `lineItemType === "explorer"`.
- Both catalog entry paths receive identical Project-row rendering and locked identity fields.
- Allow nullable quantity and cost when editing any existing catalog row.
- Keep the Item Search “Add to Project” form requirement for positive quantity and cost. This remains a UI workflow rule.
- Duplicate detection should compare catalog lines by `agencyItemId`.
- Custom-line exact-code matching behavior remains unchanged.

Do not add an evidence viewer or new visible labels in this change.

### 4. Preserve current exports

File: `src/ui/exportProjectCsv.ts`

- Keep `Evidence Row Count` and `Included Observation IDs`.
- Catalog lines without evidence export `0` and blank IDs, matching current behavior.
- Catalog lines migrated from Explorer retain their existing exported evidence values.
- Do not add new CSV columns in this change.

### 5. Update tests

Primary file: `src/projects/projectStorage.test.ts`

Update existing assertions and add coverage for:

1. Item Search creates a `catalog` line with evidence.
2. Exact-code matching creates a `catalog` line without evidence.
3. Both render with locked code, description, and unit.
4. Both permit nullable quantity and cost after persistence.
5. Schema-v8 `explorer` migrates to schema-v9 `catalog`.
6. Migration preserves the complete evidence snapshot.
7. Schema-v8 `catalog` remains catalog with null evidence.
8. Duplicate detection treats both catalog entry paths identically.
9. Construction totals include all catalog lines.
10. Custom lines remain unchanged and count as Other Costs.
11. JSON backup import accepts v4–v8 and exports v9.
12. A malformed non-null evidence snapshot causes the containing Project to be rejected under existing whole-Project rejection rules.

Update CSV tests only where fixtures or type names require it.

### 6. Update documentation

Files:

- `architecture_overview.md`
- `docs/data_schema.md`

Document:

- Project schema v9.
- Only `catalog` and `custom` line types exist.
- Catalog lines may contain optional pricing evidence.
- Entry path does not determine line identity.
- Explorer-derived evidence is retained during migration.
- Quantity and cost may be incomplete in stored catalog rows.

### 7. Verification

Run:

```powershell
C:\Users\Casey.Walrath\Tools\node\node.exe .\node_modules\typescript\bin\tsc
C:\Users\Casey.Walrath\Tools\node\node.exe .\node_modules\vitest\vitest.mjs run --configLoader native
C:\Users\Casey.Walrath\Tools\node\node.exe .\node_modules\vite\bin\vite.js build --outDir dist-check --configLoader native
git diff --check
```

Acceptance condition: no runtime or persisted v9 line uses `"explorer"`, while imported legacy Explorer lines retain all saved evidence as optional metadata on `"catalog"` lines.
