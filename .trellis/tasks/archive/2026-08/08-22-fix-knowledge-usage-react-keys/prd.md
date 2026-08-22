# Fix knowledge usage React keys

## Goal

Eliminate the duplicate React key warning in the Knowledge document detail view while preserving every downstream usage record returned by the governed Knowledge contract.

## Background

- `get_knowledge_document` returns one `usage` item for every selected evidence block belonging to the requested document.
- A single semantic Candidate revision can therefore appear more than once with the same `usage_kind`, `subject_id`, and `subject_revision`, while each row has a different `evidence_ref`.
- `apps/web/src/components/knowledge/knowledge-workspace.tsx:814` currently builds the React key from only the subject tuple, so a multi-block evidence selection produces duplicate sibling keys.
- `knowledgeUsageReferenceSchema` requires an exact `evidence_ref` containing the document revision, block ID, and block hash; this reference is the distinguishing identity already present in the parsed DTO.

## Requirements

- R1: Each rendered downstream usage row must have a stable key that includes both the semantic subject identity and the exact evidence-block identity.
- R2: The UI must retain all usage rows. It must not deduplicate records that refer to different evidence blocks.
- R3: The implementation must continue consuming the parsed `KnowledgeDocumentDetail` contract and must not introduce client-side reinterpretation of raw API data.
- R4: Add a focused regression test proving that two usages for the same Candidate revision but different evidence blocks receive distinct identities.
- R5: Keep the change scoped to the Knowledge usage rendering path and its test.

## Acceptance Criteria

- [x] Two usage rows with identical `usage_kind`, `subject_id`, and `subject_revision` but different `evidence_ref.block_id` produce distinct React keys.
- [x] Both usage rows remain rendered; no client-side deduplication is added.
- [x] The focused regression test passes.
- [x] Web type checking and relevant Web tests pass without including unrelated `.next/standalone` artifacts.
- [x] Only task-owned files are staged, and the completed fix is recorded in one scoped Git commit.

## Out of Scope

- Changing the PostgreSQL usage projection or its uniqueness constraints.
- Collapsing evidence-block-level usage into one subject-level summary row.
- Redesigning the Knowledge detail panel or changing displayed copy.

## Key Decisions and Risks

- Preserve evidence-block granularity because it is part of the authoritative contract; fix view identity rather than suppressing or deduplicating valid rows.
- Reuse the existing canonical block-reference identity fields so the key remains deterministic across renders.
- Risk is low and localized. The main regression risk is accidentally omitting part of the evidence identity, which the focused test will cover.
