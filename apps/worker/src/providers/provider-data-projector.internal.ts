import { type ArtifactReference, type PortResult, sha256ContentHash } from "@data-agent/contracts";
import {
  createInternalAgentDataProjectionReceipt,
  type InternalAgentDataProjectionReceipt,
} from "./agent-data-projection-receipt.internal.js";

const credentialMaterial =
  /(?:["']?\b(?:password|passwd|token|secret|api\s*[_-]?\s*key|authorization)["']?\s*[:=]\s*["']?\S+|\bbearer\s+[A-Za-z0-9._~+/-]{8,}={0,2}|\bsk-[A-Za-z0-9_-]{12,}|\bgh[pousr]_[A-Za-z0-9_]{20,}|\bglpat-[A-Za-z0-9_-]{20,}|\bxox[baprs]-[A-Za-z0-9-]{10,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}|-----BEGIN\s+[A-Z ]*PRIVATE\s+KEY-----)/i;

interface InspectedProjection {
  readonly messages: readonly [{ readonly role: "user"; readonly content: string }];
}

const inspectedProjections = new WeakSet<object>();

function failure<T>(code: string, message: string): PortResult<T> {
  return { ok: false, error: { code, message, retryable: false } };
}

export function inspectProviderTaskProjection(input: {
  readonly question: string;
  readonly allowed_audiences: readonly string[];
}): PortResult<InspectedProjection> {
  if (!input.allowed_audiences.includes("PRIVATE")) {
    return failure("PROVIDER_EGRESS_DENIED", "Effective Egress 未允许 PRIVATE data audience。");
  }
  const normalizedQuestion = input.question.replace(/\\(["'])/g, "$1").replace(/\s+/g, " ");
  if (credentialMaterial.test(normalizedQuestion)) {
    return failure(
      "PROVIDER_DATA_PROJECTION_DLP_REJECTED",
      "Provider task 命中 credential DLP；U3 fail-closed policy 不向外部模型发送该内容。",
    );
  }
  const projection = Object.freeze({
    messages: Object.freeze([
      Object.freeze({ role: "user" as const, content: input.question }),
    ]) as readonly [{ readonly role: "user"; readonly content: string }],
  });
  inspectedProjections.add(projection);
  return { ok: true, value: projection };
}

export async function createGovernedAgentDataProjectionReceipt(input: {
  readonly inspected: InspectedProjection;
  readonly scope: {
    readonly app_id: string;
    readonly tenant_id: string;
    readonly environment: string;
  };
  readonly run_id: string;
  readonly request_id: string;
  readonly principal_id: string;
  readonly model_execution_profile_hash: string;
  readonly task_ref: ArtifactReference;
  readonly classification: "PUBLIC" | "INTERNAL" | "RESTRICTED" | "SECRET";
  readonly payload_hash: string;
  readonly token_bound_policy_version: "utf8-byte-upper-bound@1.0.0";
  readonly trusted_input_token_upper_bound: number;
}): Promise<PortResult<InternalAgentDataProjectionReceipt>> {
  if (!inspectedProjections.has(input.inspected)) {
    return failure(
      "PROVIDER_DATA_PROJECTION_NOT_AUTHORIZED",
      "Projection Receipt 只能由 package-private DLP projector 生成。",
    );
  }
  const taintHash = await sha256ContentHash({
    hash_domain: "provider-taint@1.0.0",
    task_ref: input.task_ref,
    classification: input.classification,
    payload_hash: input.payload_hash,
    projected_messages: input.inspected.messages,
  });
  const receipt = await createInternalAgentDataProjectionReceipt({
    document: {
      artifact_type: "AgentDataProjectionReceipt",
      protocol_version: "agent-data-projection@2.0.0",
      scope: input.scope,
      run_id: input.run_id,
      request_id: input.request_id,
      principal_id: input.principal_id,
      model_execution_profile_hash: input.model_execution_profile_hash,
      input_refs: [input.task_ref],
      approved_fields: ["question"],
      classification: input.classification,
      payload_hash: input.payload_hash,
      token_bound_policy_version: input.token_bound_policy_version,
      trusted_input_token_upper_bound: input.trusted_input_token_upper_bound,
      redaction: { count: 0, policy_version: "provider-redaction-fail-closed@1.0.0" },
      dlp: { status: "PASS", policy_version: "provider-credential-dlp@1.0.0" },
      taint: { policy_version: "provider-taint@1.0.0", taint_hash: taintHash },
    },
  });
  return { ok: true, value: receipt };
}
