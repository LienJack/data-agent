import {
  type ArtifactReference,
  artifactReferenceIdentity,
  canonicalizeJson,
  computeL2ArtifactContentHash,
  type L2ArtifactDocument,
  l2ArtifactDocumentSchema,
} from "@data-agent/contracts";
import { createLogicalPlanPayload, type ValidatedLogicalPlan } from "@data-agent/text2sql";
import {
  registerAuthoritativeLogicalPlanBinding,
  registerTrustedLogicalPlanCompilerAuthority,
} from "@data-agent/text2sql/server";
import {
  artifactReference,
  fixtureIds,
  fixturePrincipalId,
  fixtureScope,
} from "./commerce-fixture.js";

type Scope = Readonly<{
  app_id: string;
  tenant_id: string;
  environment: string;
}>;

type CompilerAuthorityFixtureOptions = Readonly<{
  scope?: Scope;
  run_id?: string;
  principal_id?: string;
  committed?: boolean;
  revoke_after_first_verification?: boolean;
  artifact_id?: string;
}>;

function documentReference(
  document: L2ArtifactDocument,
): ArtifactReference & { artifact_type: "LogicalPlan" } {
  return {
    artifact_id: document.envelope.artifact_id,
    artifact_type: "LogicalPlan",
    app_id: document.envelope.app_id,
    tenant_id: document.envelope.tenant_id,
    environment: document.envelope.environment,
    run_id: document.envelope.run_id,
    revision: document.envelope.revision,
    content_hash: document.envelope.content_hash,
  };
}

/**
 * 测试专用的服务端 Composition Root：先生成内容寻址的 COMMITTED LogicalPlan 文档，
 * 再注册 package-private Authority。公开编译器测试不会直接传 resolver/callback。
 */
export async function committedLogicalPlanAuthorityFixture(
  logicalPlan: ValidatedLogicalPlan,
  options: CompilerAuthorityFixtureOptions = {},
) {
  const scope = options.scope ?? fixtureScope;
  const runId = options.run_id ?? fixtureIds.run;
  const principalId = options.principal_id ?? fixturePrincipalId;
  const semanticQueryReference = {
    ...artifactReference("SemanticQuery"),
    ...scope,
    run_id: runId,
  };
  const draft = l2ArtifactDocumentSchema.parse({
    envelope: {
      artifact_id: options.artifact_id ?? "00000000-0000-4000-8000-000000000090",
      artifact_type: "LogicalPlan",
      ...scope,
      run_id: runId,
      revision: 1,
      parent_ref: null,
      attempt_id: fixtureIds.attempt,
      producer: { kind: "deterministic", id: "postgresql-logical-plan-authority-fixture" },
      input_refs: [semanticQueryReference],
      schema_version: "data-agent-artifact/v1",
      semantic_version: "logical-plan@1.0.0",
      policy_version: "compiler-authority@1.0.0",
      model_profile_version: "deterministic",
      content_hash: `sha256:${"0".repeat(64)}`,
      status: "COMMITTED",
      created_at: "2026-07-26T00:00:00.000Z",
    },
    payload: createLogicalPlanPayload({
      draft: logicalPlan,
      semantic_query_ref: semanticQueryReference,
    }),
  });
  const document = l2ArtifactDocumentSchema.parse({
    ...draft,
    envelope: {
      ...draft.envelope,
      content_hash: await computeL2ArtifactContentHash(draft),
    },
  });
  const reference = documentReference(document);
  const committed = options.committed ?? true;
  let verificationCount = 0;
  const authority: unknown = registerTrustedLogicalPlanCompilerAuthority({
    principal_id: principalId,
    resolveCommitted: async (candidate) =>
      committed && artifactReferenceIdentity(candidate) === artifactReferenceIdentity(reference)
        ? document
        : null,
    verifyCommitted: async (candidate) => {
      const matches =
        committed && artifactReferenceIdentity(candidate) === artifactReferenceIdentity(reference);
      verificationCount += 1;
      return matches && (!options.revoke_after_first_verification || verificationCount === 1);
    },
    verifyCommitterCapability: async (claim) =>
      canonicalizeJson(claim) ===
      canonicalizeJson({
        kind: "artifact-committer",
        app_id: reference.app_id,
        tenant_id: reference.tenant_id,
        environment: reference.environment,
        run_id: reference.run_id,
        attempt_id: fixtureIds.attempt,
        artifact_type: "LogicalPlan",
        producer_id: "postgresql-logical-plan-authority-fixture",
        policy_version: "compiler-authority@1.0.0",
      }),
    verifyPrincipalCapability: async (claim) =>
      canonicalizeJson(claim) ===
      canonicalizeJson({
        kind: "logical-plan-compiler",
        app_id: reference.app_id,
        tenant_id: reference.tenant_id,
        environment: reference.environment,
        run_id: reference.run_id,
        principal_id: principalId,
        logical_plan_ref: reference,
      }),
  });

  return {
    authority,
    document,
    reference,
    bind: (
      candidate: unknown = logicalPlan,
      candidateReference: unknown = reference,
      candidateAuthority: unknown = authority,
    ) =>
      registerAuthoritativeLogicalPlanBinding({
        logical_plan: candidate,
        reference: candidateReference,
        authority: candidateAuthority,
      }),
  };
}
