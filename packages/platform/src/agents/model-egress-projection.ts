import {
  buildKnowledgeDataProjectionReceipt,
  buildKnowledgeQueryProjectionReceipt,
  type KnowledgeBaseReference,
  type KnowledgeClassification,
  type KnowledgeDataProjectionReceipt,
  type KnowledgeGenerationReference,
  type KnowledgeQueryProjectionReceipt,
  sha256ContentHash,
  type WorkspaceFileReference,
} from "@data-agent/contracts";

const credentialPatterns = [
  /(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s]{8,}/iu,
  /(?:sk|pk)-[A-Za-z0-9_-]{16,}/u,
];
const piiPatterns = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /\b(?:\+?86[- ]?)?1[3-9]\d{9}\b/u,
];
const injectionPatterns = [
  /ignore (?:all |the )?previous instructions/iu,
  /system prompt/iu,
  /reveal (?:your )?(?:prompt|credentials|secrets)/iu,
];

export async function projectKnowledgeChunkForEgress(
  input: Readonly<{
    receipt_id: string;
    scope: { app_id: string; tenant_id: string; environment: string };
    knowledge_base_ref: KnowledgeBaseReference;
    source_file_ref: WorkspaceFileReference;
    chunk_id: string;
    classification: KnowledgeClassification;
    provider: string;
    projection_policy_version: string;
    normalized_text: string;
    projected_at: string;
  }>,
): Promise<Readonly<{ receipt: KnowledgeDataProjectionReceipt; projected_text: string | null }>> {
  const credentialFindingCount = credentialPatterns.filter((pattern) =>
    pattern.test(input.normalized_text),
  ).length;
  const piiFindingCount = piiPatterns.filter((pattern) =>
    pattern.test(input.normalized_text),
  ).length;
  const promptInjectionDetected = injectionPatterns.some((pattern) =>
    pattern.test(input.normalized_text),
  );
  const allow =
    (input.classification === "PUBLIC" || input.classification === "INTERNAL") &&
    credentialFindingCount === 0 &&
    piiFindingCount === 0 &&
    !promptInjectionDetected;
  const normalizedText = input.normalized_text.normalize("NFC").replaceAll("\r\n", "\n");
  const receipt = await buildKnowledgeDataProjectionReceipt({
    schema_version: "knowledge-data-projection-receipt@1.0.0",
    receipt_id: input.receipt_id,
    scope: input.scope,
    knowledge_base_ref: input.knowledge_base_ref,
    source_file_ref: input.source_file_ref,
    chunk_id: input.chunk_id,
    classification: input.classification,
    provider: input.provider,
    projection_policy_version: input.projection_policy_version,
    redaction_count: 0,
    pii_finding_count: piiFindingCount,
    credential_finding_count: credentialFindingCount,
    prompt_injection_detected: promptInjectionDetected,
    decision: allow ? "ALLOW" : "POLICY_BLOCKED",
    payload_hash: await sha256ContentHash(normalizedText),
    projected_at: input.projected_at,
  });
  return Object.freeze({ receipt, projected_text: allow ? normalizedText : null });
}

export async function projectKnowledgeQueryForEgress(
  input: Readonly<{
    receipt_id: string;
    scope: { app_id: string; tenant_id: string; environment: string };
    knowledge_base_ref: KnowledgeBaseReference;
    generation_ref: KnowledgeGenerationReference;
    classification: KnowledgeClassification;
    provider: string;
    projection_policy_version: string;
    query: string;
    projected_at: string;
  }>,
): Promise<Readonly<{ receipt: KnowledgeQueryProjectionReceipt; projected_text: string | null }>> {
  const credentialFindingCount = credentialPatterns.filter((pattern) =>
    pattern.test(input.query),
  ).length;
  const piiFindingCount = piiPatterns.filter((pattern) => pattern.test(input.query)).length;
  const promptInjectionDetected = injectionPatterns.some((pattern) => pattern.test(input.query));
  const allow =
    (input.classification === "PUBLIC" || input.classification === "INTERNAL") &&
    credentialFindingCount === 0 &&
    piiFindingCount === 0 &&
    !promptInjectionDetected;
  const projectedText = input.query.normalize("NFC").replaceAll("\r\n", "\n").trim();
  const receipt = await buildKnowledgeQueryProjectionReceipt({
    schema_version: "knowledge-query-projection-receipt@1.0.0",
    receipt_id: input.receipt_id,
    scope: input.scope,
    knowledge_base_ref: input.knowledge_base_ref,
    generation_ref: input.generation_ref,
    classification: input.classification,
    provider: input.provider,
    projection_policy_version: input.projection_policy_version,
    pii_finding_count: piiFindingCount,
    credential_finding_count: credentialFindingCount,
    prompt_injection_detected: promptInjectionDetected,
    decision: allow ? "ALLOW" : "POLICY_BLOCKED",
    payload_hash: await sha256ContentHash(projectedText),
    projected_at: input.projected_at,
  });
  return Object.freeze({ receipt, projected_text: allow ? projectedText : null });
}
