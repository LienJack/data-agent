import {
  type SemanticImpactPlan,
  type SemanticInductionCommitCommand,
  type SemanticInductionFact,
  type SemanticInductionSourceContent,
  type SemanticInductionTarget,
  type SemanticMetricDryRunReceipt,
  semanticCandidateDraftSchema,
  semanticInductionProposalEnvelopeSchema,
  semanticInductionTargetSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { planSemanticImpact } from "./impact-planner.js";
import { runMetricImportDryRun } from "./metric-import.js";
import { resolveStableSemanticObjects } from "./stable-object-resolver.js";

function uuidV8FromHash(hash: string): string {
  const digits = hash.slice("sha256:".length, "sha256:".length + 32).split("");
  digits[12] = "8";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

function impactKind(
  role: SemanticInductionFact["object_role"],
): SemanticImpactPlan["affected_objects"][number]["object_kind"] {
  if (
    role === "PHYSICAL_BINDING" ||
    role === "TERM" ||
    role === "RULE" ||
    role === "ONTOLOGY_ALIGNMENT"
  )
    return "ENTITY";
  return role;
}

function candidatePath(role: SemanticInductionFact["object_role"], objectId: string): string {
  return `/induction/${role.toLowerCase()}/${objectId}`;
}

function referenceIdentity(source: SemanticInductionSourceContent): string {
  return `${source.source_ref.resource_kind}:${source.source_ref.resource_id}:${source.source_ref.resource_revision}:${source.source_ref.resource_hash}`;
}

export type SemanticInductionProcessingResult =
  | Readonly<{ ok: true; command: SemanticInductionCommitCommand }>
  | Readonly<{
      ok: false;
      code: "SEMANTIC_INDUCTION_IDENTITY_CONFLICT" | "SEMANTIC_METRIC_DRY_RUN_REJECTED";
      metric_dry_run: SemanticMetricDryRunReceipt | null;
    }>;

export async function processSemanticInduction(
  input: SemanticInductionTarget,
): Promise<SemanticInductionProcessingResult> {
  const target = semanticInductionTargetSchema.parse(input);
  const requestedReferences = target.request.sources.map(
    ({ source_ref }) =>
      `${source_ref.resource_kind}:${source_ref.resource_id}:${source_ref.resource_revision}:${source_ref.resource_hash}`,
  );
  const loadedReferences = target.sources.map(referenceIdentity).sort();
  if (JSON.stringify([...requestedReferences].sort()) !== JSON.stringify(loadedReferences)) {
    throw new TypeError("SEMANTIC_INDUCTION_SOURCE_CLOSURE_MISMATCH");
  }

  let metricDryRun: SemanticMetricDryRunReceipt | null = null;
  let facts: SemanticInductionFact[] = target.sources.flatMap((source) => source.facts);
  for (const source of target.sources) {
    for (const chunk of source.document_chunks) {
      const lines = chunk.normalized_text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      for (const [lineIndex, line] of lines.entries()) {
        const match = /^(?:#{1,6}\s+|term\s*:\s*)([^:=]{2,256})$/i.exec(line);
        if (!match?.[1]) continue;
        const name = match[1].trim();
        facts.push({
          namespace: target.request.semantic_domain,
          object_role: "TERM",
          name,
          aliases: [],
          mapping_identities: [
            `document:${source.source_ref.resource_id}:chunk:${chunk.chunk_id}:line:${lineIndex}`,
          ],
          evidence_identities: [`document-chunk:${chunk.chunk_id}:${lineIndex}`],
          payload: { name, source_chunk_id: chunk.chunk_id, source_text_hash: chunk.text_hash },
        });
      }
    }
  }
  if (target.request.induction_kind === "METRIC_IMPORT") {
    const metricSource = target.sources[0];
    if (!metricSource?.metric_format) throw new TypeError("SEMANTIC_METRIC_FORMAT_REQUIRED");
    const metrics = metricSource.metrics;
    const result = await runMetricImportDryRun({
      scope: target.request.scope,
      semantic_domain: target.request.semantic_domain,
      import_id: target.request.induction_id,
      source_format: metricSource.metric_format,
      metrics,
      existing: [],
    });
    metricDryRun = result.receipt;
    if (!result.candidate_patch) {
      return { ok: false, code: "SEMANTIC_METRIC_DRY_RUN_REJECTED", metric_dry_run: metricDryRun };
    }
    facts = metrics.map((metric) => ({
      namespace: target.request.semantic_domain,
      object_role: "METRIC" as const,
      name: metric.name,
      aliases: [metric.external_id],
      mapping_identities: [`metric-exchange:${metricSource.metric_format}:${metric.external_id}`],
      evidence_identities: [`metric-input:${metric.external_id}`],
      payload: { ...metric },
    }));
  }
  if (facts.length === 0) throw new TypeError("SEMANTIC_INDUCTION_FACTS_REQUIRED");

  const identities = await resolveStableSemanticObjects(facts);
  if (identities.conflicts.length > 0) {
    return {
      ok: false,
      code: "SEMANTIC_INDUCTION_IDENTITY_CONFLICT",
      metric_dry_run: metricDryRun,
    };
  }
  const factByIdentity = new Map<string, SemanticInductionFact>();
  for (const fact of facts) {
    for (const identity of [fact.name, ...fact.aliases]) {
      factByIdentity.set(
        identity
          .normalize("NFKC")
          .trim()
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, "_")
          .replace(/^_+|_+$/g, ""),
        fact,
      );
    }
  }
  const sourceByEvidence = new Map<string, SemanticInductionSourceContent>();
  for (const source of target.sources) {
    for (const fact of source.facts) {
      for (const evidenceId of fact.evidence_identities) sourceByEvidence.set(evidenceId, source);
    }
    for (const metric of source.metrics)
      sourceByEvidence.set(`metric-input:${metric.external_id}`, source);
    for (const chunk of source.document_chunks) {
      const lines = chunk.normalized_text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      for (const [lineIndex, line] of lines.entries()) {
        if (/^(?:#{1,6}\s+|term\s*:\s*)([^:=]{2,256})$/i.test(line)) {
          sourceByEvidence.set(`document-chunk:${chunk.chunk_id}:${lineIndex}`, source);
        }
      }
    }
  }

  const evidence = [];
  for (const identity of identities.objects) {
    for (const evidenceId of identity.material.evidence_identities) {
      const source = sourceByEvidence.get(evidenceId);
      if (!source) throw new TypeError("SEMANTIC_INDUCTION_EVIDENCE_NOT_LOADED");
      evidence.push({
        evidence_id: evidenceId,
        source_ref: source.source_ref,
        locator: evidenceId,
        observation_hash: await sha256ContentHash({
          evidence_id: evidenceId,
          source_hash: source.content_hash,
        }),
        signed_business_assertion: false,
      });
    }
  }
  const uniqueEvidence = [
    ...new Map(evidence.map((item) => [item.evidence_id, item])).values(),
  ].sort((left, right) => left.evidence_id.localeCompare(right.evidence_id));

  const operations = [];
  const impactObjects = [];
  const previousObjectById = new Map(
    target.previous_objects.map((previous) => [previous.object_id, previous]),
  );
  for (const identity of identities.objects) {
    const fact = factByIdentity.get(identity.material.normalized_name);
    if (!fact) throw new TypeError("SEMANTIC_INDUCTION_FACT_NOT_RESOLVED");
    const operationHash = await sha256ContentHash({ identity, payload: fact.payload });
    operations.push({
      operation_id: uuidV8FromHash(
        await sha256ContentHash({
          induction_id: target.request.induction_id,
          object_id: identity.object_id,
        }),
      ),
      object_id: identity.object_id,
      tier: target.request.sources.every((source) => source.source_kind === "PHYSICAL_SCHEMA")
        ? ("MANDATORY_PHYSICAL_CORE" as const)
        : ("OPTIONAL_UNRESOLVED_ENHANCEMENT" as const),
      operation_hash: operationHash,
      path: candidatePath(identity.material.object_role, identity.object_id),
      previous_hash: previousObjectById.get(identity.object_id)?.object_hash ?? null,
      payload: { ...fact.payload, stable_object: identity },
    });
    impactObjects.push({
      object_id: identity.object_id,
      object_kind: impactKind(identity.material.object_role),
      previous_hash:
        target.previous_objects.find(({ object_id }) => object_id === identity.object_id)
          ?.object_hash ?? `sha256:${"0".repeat(64)}`,
      next_hash: operationHash,
    });
  }
  const impactIds = new Set(impactObjects.map(({ object_id }) => object_id));
  for (const previous of target.previous_objects) {
    if (!impactIds.has(previous.object_id)) {
      impactObjects.push({
        object_id: previous.object_id,
        object_kind: previous.object_kind,
        previous_hash: previous.object_hash,
        next_hash: previous.object_hash,
      });
    }
  }
  const impactPlan = await planSemanticImpact({
    scope: target.request.scope,
    semantic_domain: target.request.semantic_domain,
    induction_id: target.request.induction_id,
    objects: impactObjects,
    dependencies: target.dependencies,
  });
  const proposalDraft = {
    schema_version: "semantic-induction-proposal-envelope@1.0.0" as const,
    scope: target.request.scope,
    semantic_domain: target.request.semantic_domain,
    induction_id: target.request.induction_id,
    base_release_ref: target.request.base_release_ref,
    stable_objects: identities.objects,
    evidence: uniqueEvidence,
    candidates: operations
      .map(({ operation_id, object_id, tier, operation_hash }) => ({
        operation_id,
        object_id,
        tier,
        operation_hash,
      }))
      .sort((left, right) => left.operation_id.localeCompare(right.operation_id)),
  };
  const proposal = semanticInductionProposalEnvelopeSchema.parse({
    ...proposalDraft,
    proposal_hash: await sha256ContentHash(proposalDraft),
  });
  const candidateDraft = semanticCandidateDraftSchema.parse({
    schema_version: "semantic-candidate-draft@1.0.0",
    title: `Semantic induction ${target.request.induction_id}`,
    description: "Review-only deterministic semantic induction candidate.",
    semantic_domain: target.request.semantic_domain,
    change_class: "MINOR",
    risk_level: impactPlan.affected_objects.length > 100 ? "HIGH" : "MEDIUM",
    idempotency_key: target.request.induction_id,
    source_payload: {
      schema_version: "semantic-source-payload@1.0.0",
      source_kind:
        target.request.induction_kind === "SCHEMA_INDUCTION" ? "SCHEMA_DISCOVERY" : "AGENT",
      content: {
        induction_id: target.request.induction_id,
        induction_kind: target.request.induction_kind,
        proposal_hash: proposal.proposal_hash,
        evidence_ids: uniqueEvidence.map(({ evidence_id }) => evidence_id),
        review_only: true,
      },
    },
    diff: {
      schema_version: "semantic-diff@1.0.0",
      summary: "Deterministic semantic induction patch; publication requires U5 review authority.",
      operations: operations
        .map((operation) => ({
          path: operation.path,
          change_type: operation.previous_hash === null ? ("ADD" as const) : ("MODIFY" as const),
          ...(operation.previous_hash === null
            ? {}
            : { before: { object_hash: operation.previous_hash } }),
          after: operation.payload,
        }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    },
  });
  return {
    ok: true,
    command: {
      schema_version: "semantic-induction-commit-command@1.0.0",
      request: target.request,
      proposal,
      impact_plan: impactPlan,
      metric_dry_run: metricDryRun,
      candidate_draft: candidateDraft,
    },
  };
}
