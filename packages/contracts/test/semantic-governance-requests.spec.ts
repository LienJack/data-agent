import { describe, expect, it } from "vitest";
import {
  dataSourceCredentialRefSchema,
  semanticCandidateCreateResultSchema,
  semanticCandidateDraftSchema,
  semanticCommitPublishInputSchema,
  semanticPreparePublishInputSchema,
  semanticRollbackInputSchema,
} from "../src/artifacts/semantic-governance-requests.js";

const id = "00000000-0000-4000-8000-000000000001";
const hash = `sha256:${"a".repeat(64)}`;

function candidateDraft() {
  return {
    schema_version: "semantic-candidate-draft@1.0.0",
    title: "调整净收入公式",
    description: "将折扣纳入净收入计算。",
    semantic_domain: "revenue",
    change_class: "MAJOR",
    risk_level: "HIGH",
    idempotency_key: id,
    source_payload: {
      schema_version: "semantic-source-payload@1.0.0",
      source_kind: "MANUAL",
      content: { metric_id: "net_revenue", formula: "revenue-refund-discount" },
    },
    diff: {
      schema_version: "semantic-diff@1.0.0",
      summary: "净收入扣除折扣",
      operations: [
        {
          path: "metrics.net_revenue.formula",
          change_type: "MODIFY",
          before: "revenue-refund",
          after: "revenue-refund-discount",
        },
      ],
    },
  } as const;
}

describe("semantic governance request contracts", () => {
  it("accepts a strict, versioned candidate draft", () => {
    expect(semanticCandidateDraftSchema.parse(candidateDraft())).toEqual(candidateDraft());
  });

  it.each(["app_id", "tenant_id", "environment", "principal", "role"])(
    "rejects client authority field %s",
    (field) => {
      expect(() =>
        semanticCandidateDraftSchema.parse({ ...candidateDraft(), [field]: "attacker" }),
      ).toThrow();
    },
  );

  it("rejects unknown nested diff fields", () => {
    const draft = candidateDraft();
    expect(() =>
      semanticCandidateDraftSchema.parse({
        ...draft,
        diff: { ...draft.diff, attacker_override: true },
      }),
    ).toThrow();
  });

  it("requires complete publish and rollback material", () => {
    expect(() =>
      semanticPreparePublishInputSchema.parse({
        schema_version: "semantic-prepare-publish@1.0.0",
        packet_id: id,
      }),
    ).toThrow();
    expect(() =>
      semanticCommitPublishInputSchema.parse({
        schema_version: "semantic-commit-publish@1.0.0",
        packet_id: id,
        attempt_id: id,
      }),
    ).toThrow();
    expect(() =>
      semanticRollbackInputSchema.parse({
        schema_version: "semantic-rollback@1.0.0",
        authorization_id: id,
      }),
    ).toThrow();
  });

  it("keeps candidate result authority explicit", () => {
    const result = semanticCandidateCreateResultSchema.parse({
      schema_version: "semantic-candidate-create-result@1.0.0",
      authority: "POSTGRESQL",
      candidate_id: id,
      revision_id: id,
      source_revision_id: id,
      source_digest: hash,
      revision_digest: hash,
      idempotency_digest: hash,
      candidate_status: "DRAFT",
      created: true,
    });
    expect(result.authority).toBe("POSTGRESQL");
  });

  it("rejects secret values and provider locators in credential references", () => {
    const credentialRef = {
      schema_version: "datasource-credential-ref@1.0.0",
      app_id: id,
      tenant_id: id,
      environment: "development",
      credential_ref_id: id,
      secret_ref_id: id,
      secret_version: 1,
      rotation_state: "ACTIVE",
    } as const;

    expect(dataSourceCredentialRefSchema.parse(credentialRef)).toEqual(credentialRef);
    expect(() =>
      dataSourceCredentialRefSchema.parse({ ...credentialRef, password: "secret" }),
    ).toThrow();
    expect(() =>
      dataSourceCredentialRefSchema.parse({ ...credentialRef, provider_locator: "vault://secret" }),
    ).toThrow();
  });
});
