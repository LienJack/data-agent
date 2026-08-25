import { createHash } from "node:crypto";
import { buildSemanticContextRequest } from "@data-agent/contracts/context";
import { workspaceDefaultsReferenceSchema } from "@data-agent/contracts/workspaces";
import { buildFalcon24AgentAnalysisAcceptanceSuite } from "@data-agent/evals";
import { adaptPgPool } from "@data-agent/platform/persistence";
import { createPostgresEffectiveConfigResolver } from "@data-agent/platform/runs";
import { createPostgresSemanticContextRegistry } from "@data-agent/platform/semantic-postgres";
import { createPostgresCapabilityAuthority } from "@data-agent/platform/tenancy";
import { createSemanticContextService } from "@data-agent/semantic/runtime-context";
import type { Pool } from "pg";
import type { FalconSemanticActivationScope } from "./falcon-semantic-activation";

function stableUuid(material: string): string {
  const digits = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  digits[12] = "5";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function requireValue<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly code: string } },
): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

export async function verifyFalconSemanticRetrieval(input: {
  readonly pool: Pool;
  readonly scope: FalconSemanticActivationScope;
}) {
  const sqlPool = adaptPgPool(input.pool);
  const authority = createPostgresCapabilityAuthority(sqlPool);
  const capability = requireValue(
    await authority.resolveForServerContext({
      deployment_id: input.scope.deploymentId,
      tenant_id: input.scope.workspaceId,
      principal_id: input.scope.principalId,
      access: "READ",
    }),
  );
  const defaults = requireValue(
    await createPostgresEffectiveConfigResolver({
      pool: sqlPool,
      authorizer: authority.authorizer,
    }).getWorkspaceDefaults(capability),
  );
  const defaultsReference = workspaceDefaultsReferenceSchema.parse(defaults?.defaults_ref);
  const service = createSemanticContextService({
    authority: createPostgresSemanticContextRegistry({
      pool: sqlPool,
      authorizer: authority.authorizer,
    }),
  });
  const suite = await buildFalcon24AgentAnalysisAcceptanceSuite();
  const cases = [];
  for (const testCase of suite.cases) {
    const request = await buildSemanticContextRequest({
      schema_version: "semantic-context-request@1.0.0",
      request_id: stableUuid(
        `falcon24:semantic-retrieval:${defaultsReference.defaults_hash}:${testCase.case_id}`,
      ),
      scope: capability.scope,
      question: testCase.question,
      basis: { consumer: "PREVIEW", defaults_ref: defaultsReference },
    });
    const preview = requireValue(await service.preview(capability, request));
    const packageDocument = preview.package;
    const caseObjectId = `case.${testCase.case_id}`;
    const missingClosureObjects = testCase.required_semantic_keys.filter(
      (objectId) => !packageDocument.mandatory_closure.object_ids.includes(objectId),
    );
    const prunedMandatoryObjects = packageDocument.mandatory_closure.object_ids.filter((objectId) =>
      packageDocument.retrieval_receipt.pruned_object_ids.includes(objectId),
    );
    const vectorHit = packageDocument.retrieval_receipt.hits.some(
      (hit) => hit.route === "VECTOR" && hit.object_id === caseObjectId,
    );
    const exactLexicon = packageDocument.route_decision.lexical_evidence.some(
      (entry) =>
        entry.target_id === caseObjectId &&
        entry.match_kind === "CANONICAL" &&
        entry.phrase === testCase.question,
    );
    const routeStates = packageDocument.retrieval_receipt.route_states;
    if (
      packageDocument.route_decision.state !== "READY" ||
      packageDocument.route_decision.route !== "GRAPH" ||
      !packageDocument.route_decision.selected_ontology_ids.includes(caseObjectId) ||
      !exactLexicon ||
      !vectorHit ||
      Object.values(routeStates).some((state) => state !== "READY") ||
      packageDocument.retrieval_receipt.fallback_reason_codes.length > 0 ||
      packageDocument.retrieval_receipt.expansions.length === 0 ||
      packageDocument.retrieval_receipt.pruned_object_ids.length === 0 ||
      packageDocument.inference_receipt.steps.length === 0 ||
      !packageDocument.inference_receipt.closure_complete ||
      missingClosureObjects.length > 0 ||
      prunedMandatoryObjects.length > 0
    ) {
      throw new Error(`FALCON_SEMANTIC_RETRIEVAL_INVALID:${testCase.case_id}`);
    }
    cases.push({
      case_id: testCase.case_id,
      question: testCase.question,
      route: packageDocument.route_decision.route,
      selected_case_object_id: caseObjectId,
      route_states: routeStates,
      hit_count: packageDocument.retrieval_receipt.hits.length,
      selected_object_count: packageDocument.retrieval_receipt.selected_object_ids.length,
      expansion_count: packageDocument.retrieval_receipt.expansions.length,
      inference_step_count: packageDocument.inference_receipt.steps.length,
      mandatory_object_count: packageDocument.mandatory_closure.object_ids.length,
      mandatory_relationship_count: packageDocument.mandatory_closure.relationship_ids.length,
      pruned_object_count: packageDocument.retrieval_receipt.pruned_object_ids.length,
      closure_hash: packageDocument.mandatory_closure.closure_hash,
      package_hash: packageDocument.package_hash,
    });
  }
  return Object.freeze({
    schema_version: "falcon-semantic-retrieval-acceptance@1.0.0" as const,
    terminal: "PASS" as const,
    workspace_id: input.scope.workspaceId,
    defaults_ref: defaultsReference,
    case_count: cases.length,
    cases: Object.freeze(cases),
  });
}
