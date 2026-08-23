# Technical Design

## Authority and Runtime Boundaries

- PostgreSQL owns Task, Attempt, Event, Artifact, Effect, Acceptance, Semantic Release, Falcon Receipt and audit truth.
- Mastra is internal-only composition under `packages/agent-runtime`; public contracts remain framework-neutral.
- Semantic Agent emits Candidate only. Deterministic validation plus one-shot Bootstrap Publisher creates v1; the Agent cannot self-review or self-publish.
- Text2SQL consumes an exact Published Release and produces compiler/gate/execution evidence. Report consumes only authoritative Artifact references.

## Agent Team

1. Semantic Profile: schema/business-source tools, semantic authoring skills, bootstrap workflow, no SQL execution or report publication.
2. Text2SQL Profile: published semantic/context resolver, compiler, seven gates, SQL sandbox; no semantic mutation or report authority.
3. Report Profile: evidence resolver and deterministic report projector; no raw datasource access or semantic mutation.
4. Orchestrator: static DAG, TaskCapability, lease/fence, bounded typed handoff and one optional Text2SQL follow-up for report evidence gaps. No recursive delegation.

## Context and Recovery

- Each step compiles a Model View from Goal/Task/Event watermark plus exact Artifact refs.
- `ContextBuildManifest`, `BuildSignature`, `OmissionLedger` and `ContextEpoch` make compaction auditable.
- Checkpoints occur before provider dispatch, external tool body, handoff and completion.
- Recovery order: repair, replay, reconcile unknown outcome, rebuild view, explicit new Attempt resume.

## Greenfield and Falcon

- Journey and Falcon use distinct Workspace, Schema, Semantic Domain, Policy, Grant and Receipt namespaces.
- Existing Falcon import is read-only input. No loader, backfill or second import is run.
- All 28 Falcon schemas receive schema-grounded Semantic v1 before per-case Text2SQL.
- Bootstrap Corpus excludes sealed questions, Gold SQL, expected results and TEST/Holdout content. Per-case runtime receives only the public question.

## Rollback

- Before v1 publish: discard Candidate and revoke the bootstrap grant.
- After one-shot v1 publish: preserve immutable Release/Receipt and stop downstream tasks; do not destructively delete data.
- Mastra snapshots may be discarded and rebuilt from PostgreSQL authority.
