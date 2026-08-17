import { describe, expect, it } from "vitest";
import {
  buildSemanticImpactPlan,
  buildSemanticInductionReceipt,
  buildSemanticInductionSourceRegistrationCommand,
  buildSemanticMetricDryRunReceipt,
  computeSemanticInductionProposalHash,
  semanticInductionProposalEnvelopeSchema,
  semanticInductionRejectCommandSchema,
  semanticInductionRequestSchema,
  semanticInductionSourceSchema,
  semanticStableObjectIdentityMaterialSchema,
  semanticStableObjectIdFromIdentityHash,
  verifySemanticImpactPlan,
  verifySemanticInductionProposalEnvelope,
  verifySemanticInductionReceipt,
  verifySemanticMetricDryRunReceipt,
} from "../src/artifacts/semantic-induction.js";
import { sha256ContentHash } from "../src/common/index.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "development" } as const;

describe("semantic induction contracts", () => {
  it("accepts exact governed sources and rejects benchmark-derived taint", () => {
    const source = {
      schema_version: "semantic-induction-source@1.0.0",
      source_kind: "KNOWLEDGE_DOCUMENT",
      source_ref: {
        resource_kind: "KNOWLEDGE_REVISION",
        resource_id: id(3),
        resource_revision: 2,
        resource_hash: hash("a"),
      },
      corpus_class: "SEMANTIC_BOOTSTRAP_CORPUS",
      taint: {
        contains_holdout_or_test: false,
        contains_gold_or_expected_output: false,
        contains_oracle_feedback: false,
        sealed_benchmark: false,
      },
    } as const;
    expect(semanticInductionSourceSchema.parse(source)).toEqual(source);
    expect(() =>
      semanticInductionSourceSchema.parse({
        ...source,
        taint: { ...source.taint, contains_holdout_or_test: true },
      }),
    ).toThrow();
    expect(() =>
      semanticInductionSourceSchema.parse({ ...source, corpus_class: "LOCAL_HOLDOUT" }),
    ).toThrow();
  });

  it("requires canonical stable identity material", () => {
    const material = {
      schema_version: "semantic-stable-object-identity-material@1.0.0",
      namespace: "commerce",
      object_role: "METRIC",
      normalized_name: "gross_revenue",
      mapping_identities: ["column:public.orders.amount", "relation:public.orders"],
      evidence_identities: ["evidence:a", "evidence:b"],
    } as const;
    expect(semanticStableObjectIdentityMaterialSchema.parse(material)).toEqual(material);
    expect(() =>
      semanticStableObjectIdentityMaterialSchema.parse({
        ...material,
        mapping_identities: [...material.mapping_identities].reverse(),
      }),
    ).toThrow();
  });

  it("rejects self-hashed proposals whose stable object identity was substituted", async () => {
    const material = semanticStableObjectIdentityMaterialSchema.parse({
      schema_version: "semantic-stable-object-identity-material@1.0.0",
      namespace: "commerce",
      object_role: "METRIC",
      normalized_name: "gross_revenue",
      mapping_identities: ["column:public.orders.amount"],
      evidence_identities: ["evidence:gmv"],
    });
    const identityHash = await sha256ContentHash(material);
    const draft = {
      schema_version: "semantic-induction-proposal-envelope@1.0.0" as const,
      scope,
      semantic_domain: "commerce",
      induction_id: id(4),
      base_release_ref: null,
      stable_objects: [
        {
          schema_version: "semantic-stable-object-identity@1.0.0" as const,
          object_id: semanticStableObjectIdFromIdentityHash(identityHash),
          identity_hash: identityHash,
          material,
          aliases: [],
        },
      ],
      evidence: [
        {
          evidence_id: "evidence:gmv",
          source_ref: {
            resource_kind: "SCHEMA_SNAPSHOT" as const,
            resource_id: id(3),
            resource_revision: 1,
            resource_hash: hash("a"),
          },
          locator: "column:public.orders.amount",
          observation_hash: hash("b"),
          signed_business_assertion: false,
        },
      ],
      candidates: [
        {
          operation_id: id(5),
          object_id: semanticStableObjectIdFromIdentityHash(identityHash),
          tier: "MANDATORY_PHYSICAL_CORE" as const,
          operation_hash: hash("c"),
        },
      ],
    };
    const proposal = semanticInductionProposalEnvelopeSchema.parse({
      ...draft,
      proposal_hash: await computeSemanticInductionProposalHash({
        ...draft,
        proposal_hash: hash("0"),
      }),
    });
    await expect(verifySemanticInductionProposalEnvelope(proposal)).resolves.toEqual(proposal);
    const substituted = {
      ...proposal,
      stable_objects: [{ ...proposal.stable_objects[0], identity_hash: hash("d") }],
    };
    const rehashed = {
      ...substituted,
      proposal_hash: await computeSemanticInductionProposalHash(
        semanticInductionProposalEnvelopeSchema.parse(substituted),
      ),
    };
    await expect(verifySemanticInductionProposalEnvelope(rehashed)).rejects.toThrow(
      "SEMANTIC_STABLE_OBJECT_IDENTITY_MISMATCH",
    );
  });

  it("keeps induction requests free of publish authority", () => {
    const request = {
      schema_version: "semantic-induction-request@1.0.0",
      scope,
      semantic_domain: "commerce",
      induction_id: id(4),
      induction_kind: "DOCUMENT_INDUCTION",
      base_release_ref: null,
      sources: [
        {
          schema_version: "semantic-induction-source@1.0.0",
          source_kind: "KNOWLEDGE_DOCUMENT",
          source_ref: {
            resource_kind: "KNOWLEDGE_REVISION",
            resource_id: id(3),
            resource_revision: 2,
            resource_hash: hash("a"),
          },
          corpus_class: "SEMANTIC_BOOTSTRAP_CORPUS",
          taint: {
            contains_holdout_or_test: false,
            contains_gold_or_expected_output: false,
            contains_oracle_feedback: false,
            sealed_benchmark: false,
          },
        },
      ],
      idempotency_key: "semantic-induction:fixture",
    } as const;
    expect(semanticInductionRequestSchema.parse(request)).toEqual(request);
    expect(() => semanticInductionRequestSchema.parse({ ...request, publish: true })).toThrow();
  });

  it("keeps metric and foundational registration payloads role-pure", async () => {
    const common = {
      schema_version: "semantic-induction-source-register@1.0.0" as const,
      scope,
      semantic_domain: "commerce",
      resource_id: id(40),
      resource_revision: 1,
    };
    await expect(
      buildSemanticInductionSourceRegistrationCommand({
        ...common,
        source_kind: "METRIC_EXCHANGE",
        content: {
          metric_format: "OSI_METRIC_EXCHANGE",
          facts: [],
          metrics: [
            {
              external_id: "gmv",
              name: "Gross Revenue",
              expression: "sum(order_amount)",
              unit: "CNY",
            },
          ],
          dependencies: [],
        },
      }),
    ).resolves.toMatchObject({ source_kind: "METRIC_EXCHANGE" });
    await expect(
      buildSemanticInductionSourceRegistrationCommand({
        ...common,
        source_kind: "FOUNDATIONAL_ONTOLOGY",
        content: {
          metric_format: null,
          facts: [
            {
              namespace: "commerce",
              object_role: "METRIC",
              name: "Gross Revenue",
              aliases: [],
              mapping_identities: ["foundation:gmv"],
              evidence_identities: ["foundation:evidence:gmv"],
              payload: {},
            },
          ],
          metrics: [],
          dependencies: [],
        },
      }),
    ).rejects.toThrow("Foundational source registration");
  });

  it("hashes impact, metric dry-run and induction receipts and rejects tampering", async () => {
    const impact = await buildSemanticImpactPlan({
      schema_version: "semantic-impact-plan@1.0.0",
      scope,
      semantic_domain: "commerce",
      induction_id: id(4),
      changed_object_ids: [id(10)],
      affected_objects: [
        {
          object_id: id(10),
          object_kind: "METRIC",
          previous_hash: hash("a"),
          next_hash: hash("b"),
        },
        { object_id: id(11), object_kind: "QUERY", previous_hash: hash("c"), next_hash: hash("c") },
      ],
      unchanged_object_hashes: [{ object_id: id(12), object_hash: hash("d") }],
    });
    expect((await verifySemanticImpactPlan(impact)).plan_hash).toBe(impact.plan_hash);
    await expect(
      verifySemanticImpactPlan({ ...impact, changed_object_ids: [id(11)] }),
    ).rejects.toThrow();

    const dryRun = await buildSemanticMetricDryRunReceipt({
      schema_version: "semantic-metric-dry-run-receipt@1.0.0",
      scope,
      semantic_domain: "commerce",
      import_id: id(20),
      source_hash: hash("e"),
      status: "VALID",
      entries: [
        { external_id: "gmv", disposition: "CREATE", stable_object_id: id(21), issues: [] },
      ],
      candidate_patch_hash: hash("f"),
    });
    expect((await verifySemanticMetricDryRunReceipt(dryRun)).receipt_hash).toBe(
      dryRun.receipt_hash,
    );

    const receipt = await buildSemanticInductionReceipt({
      schema_version: "semantic-induction-receipt@1.0.0",
      scope,
      semantic_domain: "commerce",
      induction_id: id(4),
      request_hash: hash("1"),
      proposal_hash: hash("2"),
      impact_plan_ref: {
        resource_id: id(30),
        resource_revision: 1,
        resource_hash: impact.plan_hash,
      },
      metric_dry_run_ref: null,
      candidate_ref: { resource_id: id(31), resource_revision: 1, resource_hash: hash("3") },
      terminal: "CANDIDATE_CREATED",
      created_at: "2026-08-17T00:00:00.000Z",
    });
    expect((await verifySemanticInductionReceipt(receipt)).receipt_hash).toBe(receipt.receipt_hash);
    expect(() =>
      semanticInductionRejectCommandSchema.parse({
        schema_version: "semantic-induction-reject-command@1.0.0",
        request: {
          schema_version: "semantic-induction-request@1.0.0",
          scope,
          semantic_domain: "commerce",
          induction_id: id(4),
          induction_kind: "METRIC_IMPORT",
          base_release_ref: null,
          sources: [
            {
              schema_version: "semantic-induction-source@1.0.0",
              source_kind: "METRIC_EXCHANGE",
              source_ref: {
                resource_kind: "METRIC_EXCHANGE_PACKAGE",
                resource_id: id(3),
                resource_revision: 1,
                resource_hash: hash("a"),
              },
              corpus_class: "SEMANTIC_BOOTSTRAP_CORPUS",
              taint: {
                contains_holdout_or_test: false,
                contains_gold_or_expected_output: false,
                contains_oracle_feedback: false,
                sealed_benchmark: false,
              },
            },
          ],
          idempotency_key: "semantic-induction:reject",
        },
        terminal: "DRY_RUN_REJECTED",
        metric_dry_run: null,
      }),
    ).toThrow();
  });
});
