import {
  type AnalysisCompletionReceiptPayload,
  type AnalysisProgramPayload,
  type ArtifactReference,
  collectL2ResearchPayloadArtifactReferences,
  computeL2ResearchEnvelopeContentHash,
  type DerivedAnalysisEvidencePayload,
  parseL2ResearchDocumentCandidate,
  type ResearchArtifactAuthorityPort,
  researchArtifactCommitInputSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import type { AnalysisArtifactCommitPort } from "./executor.js";
import { deterministicAnalysisUuid } from "./deterministic-id.js";

type AnalysisPayload =
  | AnalysisProgramPayload
  | DerivedAnalysisEvidencePayload
  | AnalysisCompletionReceiptPayload;

interface AnalysisSystemArtifactAuthority {
  commitAnalysisSystem(
    capabilityInput: unknown,
    command: unknown,
    content: Uint8Array | null,
  ): Promise<
    | { readonly ok: true; readonly created: boolean; readonly reference: ArtifactReference }
    | { readonly ok: false; readonly error_code: string }
  >;
}

function initialParent(payload: AnalysisPayload): ArtifactReference {
  switch (payload.artifact_type) {
    case "AnalysisProgram":
      return payload.brief_ref;
    case "DerivedAnalysisEvidence":
      return payload.analysis_program_ref;
    case "AnalysisCompletionReceipt": {
      const evidence = payload.node_results.flatMap(({ evidence_ref: evidenceRef }) =>
        evidenceRef ? [evidenceRef] : [],
      );
      return evidence.at(-1) ?? payload.analysis_program_ref;
    }
  }
}

async function candidate(input: {
  readonly payload: AnalysisPayload;
  readonly lease: Parameters<AnalysisArtifactCommitPort["commitL2"]>[0]["lease"];
  readonly idempotency_key: string;
  readonly created_at: string;
}) {
  const artifactId = deterministicAnalysisUuid(
    `analysis-l2\0${input.lease.run_id}\0${input.idempotency_key}\0${input.payload.artifact_type}`,
  );
  const draft = parseL2ResearchDocumentCandidate({
    envelope: {
      artifact_id: artifactId,
      artifact_type: input.payload.artifact_type,
      ...input.lease.scope,
      run_id: input.lease.run_id,
      revision: 1,
      parent_ref: null,
      attempt_id: input.lease.attempt_id,
      producer: { kind: "deterministic", id: "analysis-program-executor@1" },
      input_refs: collectL2ResearchPayloadArtifactReferences(input.payload),
      schema_version: "1.0.0",
      semantic_version: "1.0.0",
      policy_version: "analysis-program-policy@1.0.0",
      model_profile_version: "deepseek-v4-flash@1.0.0",
      content_hash: await sha256ContentHash({ placeholder: artifactId }),
      status: "CANDIDATE",
      created_at: input.created_at,
    },
    payload: input.payload,
  });
  return parseL2ResearchDocumentCandidate({
    ...draft,
    envelope: {
      ...draft.envelope,
      content_hash: await computeL2ResearchEnvelopeContentHash(draft),
    },
  });
}

export function createResearchAnalysisArtifactPort(input: {
  readonly authority: ResearchArtifactAuthorityPort & AnalysisSystemArtifactAuthority;
  readonly capability_input: unknown;
  readonly now?: () => Date;
}): AnalysisArtifactCommitPort {
  const now = input.now ?? (() => new Date());
  const expectedParents = new Map<string, ArtifactReference>();
  const latestByRun = new Map<string, ArtifactReference>();

  return Object.freeze({
    async commitL2(command: Parameters<AnalysisArtifactCommitPort["commitL2"]>[0]) {
      const document = await candidate({
        payload: command.payload,
        lease: command.lease,
        idempotency_key: command.idempotency_key,
        created_at: now().toISOString(),
      });
      const expectedParent =
        expectedParents.get(command.idempotency_key) ??
        latestByRun.get(command.lease.run_id) ??
        initialParent(command.payload);
      expectedParents.set(command.idempotency_key, expectedParent);
      const commit = researchArtifactCommitInputSchema.parse({
        schema_version: "1.0.0",
        scope: command.lease.scope,
        run_id: command.lease.run_id,
        principal_id: command.principal_id,
        idempotency_key: command.idempotency_key,
        commit_id: deterministicAnalysisUuid(
          `analysis-l2-commit\0${command.lease.run_id}\0${command.idempotency_key}`,
        ),
        attempt_id: command.lease.attempt_id,
        worker_fence: command.lease.worker_fence,
        candidate: document,
        expected_parent_ref: expectedParent,
      });
      const result = await input.authority.commitCurrent(input.capability_input, commit);
      if (!result.ok) throw new TypeError(result.error.code);
      latestByRun.set(command.lease.run_id, result.value.reference);
      return result.value.reference;
    },

    async commitSystem(command: Parameters<AnalysisArtifactCommitPort["commitSystem"]>[0]) {
      const result = await input.authority.commitAnalysisSystem(
        input.capability_input,
        {
          schema_version: "1.0.0",
          scope: command.lease.scope,
          run_id: command.lease.run_id,
          principal_id: command.principal_id,
          idempotency_key: command.idempotency_key,
          attempt_id: command.lease.attempt_id,
          worker_fence: command.lease.worker_fence,
          reference: command.reference,
          payload: command.payload as Record<string, unknown>,
        },
        command.content,
      );
      if (!result.ok) throw new TypeError(result.error_code);
      return result.reference;
    },

    async resolveCommitted(
      reference: Parameters<AnalysisArtifactCommitPort["resolveCommitted"]>[0],
    ) {
      const result = await input.authority.readHistorical(input.capability_input, reference);
      if (!result.ok) throw new TypeError(result.error.code);
      return result.value?.document ?? null;
    },
  });
}

export const researchAnalysisArtifactPortInternals = Object.freeze({
  initialParent,
  deterministicAnalysisUuid,
});
