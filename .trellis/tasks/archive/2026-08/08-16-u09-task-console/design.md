# U9 Technical Design

## Data flow

```text
PostgreSQL Run Events + Effective Config refs + Artifact envelopes
  -> Platform read-only projection/correlation
  -> ResolutionTrace + SqlHistoryEntry strict DTOs
  -> workspace-scoped routes
  -> TaskConsole / TrajectoryView (format only)
```

## Contracts

`runs/resolution-trace.ts` owns node/edge discriminated unions, trace hash, SQL History entries and result envelope.
Node identity is derived from persisted `event_id` or Artifact reference, never array position. Nodes sort by sequence then ID;
edges sort by `from/to/kind`; duplicates and missing endpoints fail schema refinement.

SQL entries expose statement/compiler hash and typed refs, but not SQL parameter values, rows, prompt, Context bytes or private
reasoning. A bounded statement preview may be omitted entirely; source Artifact remains the inspection boundary.

## Platform

Extend the event reader with one read-only projection service rather than adding tables. It loads verified events through the
existing hash checks, queries only same-scope Artifact envelopes/types, and correlates Run/Conversation bindings. SQL History
is a filtered view of existing immutable SqlArtifact and QueryEvidence lineage.

## Web and compatibility

Routes return `{data}` envelopes and use existing workspace authorization. Existing local Console content remains as loading/
fallback while the DTO is absent, but it cannot show “auditable backend trace” from client-derived guesses. Public event wire
is additive; no historical event rewrite or migration is required.

## Rollback

Disable new routes/tabs without deleting Event or Artifact data. No write path or schema migration is introduced.
