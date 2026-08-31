import { describe, expect, it } from "vitest";
import {
  buildSemanticContextAuthoritySnapshot,
  buildSemanticContextPackage,
  buildSemanticContextReceipt,
  buildSemanticContextRequest,
  verifySemanticContextCommitCommand,
  verifySemanticContextPackage,
  verifySemanticContextRequest,
} from "../src/context/semantic-context-package.js";
import {
  buildSemanticInferenceReceipt,
  buildSemanticRetrievalReceipt,
} from "../src/context/semantic-retrieval.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "development" } as const;

async function fixture() {
  const snapshot = await buildSemanticContextAuthoritySnapshot({
    schema_version: "semantic-context-authority-snapshot@1.0.0",
    scope,
    semantic_domain: "commerce",
    question: "Gross Revenue by channel",
    defaults_ref: { defaults_id: id(3), defaults_revision: 2, defaults_hash: hash("2") },
    semantic_release: {
      resource_id: id(4),
      resource_revision: 3,
      resource_hash: hash("3"),
      datasource_id: id(5),
      semantic_generation: 3,
      publication_status: "PUBLISHED",
    },
    schema_snapshot: {
      resource_id: id(6),
      resource_revision: 1,
      resource_hash: hash("4"),
      datasource_id: id(5),
      semantic_release_id: id(4),
      semantic_generation: 3,
    },
    context_policy: {
      resource_id: id(7),
      resource_revision: 1,
      resource_hash: hash("5"),
      max_context_tokens: 4_096,
      max_resource_bindings: 64,
    },
    egress_policy: {
      resource_id: id(8),
      resource_revision: 1,
      resource_hash: hash("6"),
      allowed_providers: ["deepseek"],
      allowed_audiences: ["PRIVATE"],
      classification: "INTERNAL",
    },
    provider: "deepseek",
    published_metrics: [
      {
        metric_id: "gross_revenue",
        name: "Gross Revenue",
        aliases: ["GMV"],
        mapping_refs: ["orders.order_amount"],
        mapping_hash: hash("7"),
        formula_hash: hash("8"),
      },
    ],
    published_ontology: [],
    published_relationships: [],
    knowledge_refs: [],
    projection_hashes: [hash("7"), hash("8")],
  });
  const retrievalReceipt = await buildSemanticRetrievalReceipt({
    schema_version: "semantic-retrieval-receipt@1.0.0",
    authority_snapshot_hash: snapshot.snapshot_hash,
    release_hash: snapshot.semantic_release.resource_hash,
    query_hash: snapshot.question_hash,
    rrf_k: 60,
    hard_filter: {
      scope_hash: hash("d"),
      publication_status: "PUBLISHED",
      authority_mode: "POSTGRES_FILTERED_SNAPSHOT",
      included_object_ids: ["gross_revenue"],
      excluded_objects: [],
    },
    route_states: {
      LEXICON: "READY",
      SPARSE: "READY",
      VECTOR: "UNAVAILABLE",
      GRAPH: "UNAVAILABLE",
    },
    hits: [],
    expansions: [],
    selected_object_ids: ["gross_revenue"],
    pruned_object_ids: [],
    fallback_reason_codes: ["VECTOR_ROUTE_NOT_CONFIGURED"],
  });
  const inferenceReceipt = await buildSemanticInferenceReceipt({
    schema_version: "semantic-inference-receipt@1.0.0",
    retrieval_receipt_hash: retrievalReceipt.receipt_hash,
    ruleset_id: "semantic-mandatory-closure@1",
    ruleset_hash: hash("b"),
    steps: [],
    mandatory_object_ids: ["gross_revenue"],
    mandatory_relationship_ids: [],
    closure_complete: true,
    reason_codes: [],
  });
  const packageDocument = await buildSemanticContextPackage({
    schema_version: "semantic-context-package@1.0.0",
    scope,
    semantic_domain: snapshot.semantic_domain,
    question_hash: snapshot.question_hash,
    defaults_ref: snapshot.defaults_ref,
    semantic_release: snapshot.semantic_release,
    schema_snapshot: snapshot.schema_snapshot,
    context_policy: snapshot.context_policy,
    egress_policy: snapshot.egress_policy,
    provider: snapshot.provider,
    authority_snapshot_hash: snapshot.snapshot_hash,
    route_decision: {
      schema_version: "semantic-context-route-decision@1.0.0",
      state: "READY",
      route: "METRIC",
      selected_metric_id: "gross_revenue",
      selected_ontology_ids: [],
      clarification_candidates: [],
      lexical_evidence: [],
      capability_chain: ["METRIC", "ONTOLOGY_TEXT2SQL", "KNOWLEDGE", "GRAPH"],
      reason_codes: ["EXACT_PUBLISHED_METRIC"],
    },
    capacity: {
      schema_version: "context-capacity-plan@1.0.0",
      policy_version: "utf8-byte-upper-bound@1.0.0",
      max_context_tokens: 4_096,
      max_context_bytes: 4_096,
      mandatory_bytes: 64,
      included_bytes: 64,
      cropped_bytes: 0,
      items: [
        {
          item_kind: "METRIC",
          item_id: "gross_revenue",
          item_hash: hash("7"),
          byte_size: 64,
          priority: 100,
          mandatory: true,
          disposition: "MANDATORY",
          reason_code: "ROUTE_SELECTED",
        },
      ],
    },
    evidence: [
      {
        evidence_kind: "METRIC",
        evidence_id: "gross_revenue",
        evidence_hash: hash("7"),
        summary: "Gross Revenue = sum(order_amount)",
        source_ref: null,
      },
    ],
    knowledge_refs: [],
    retrieval_receipt: retrievalReceipt,
    inference_receipt: inferenceReceipt,
    mandatory_closure: {
      object_ids: ["gross_revenue"],
      relationship_ids: [],
      closure_hash: hash("c"),
    },
    analysis_capabilities: ["TREND_CHANGE"],
  });
  return { snapshot, packageDocument };
}

describe("semantic context package contracts", () => {
  it.each([
    [false, false, false, true],
    [true, false, false, false],
    [true, true, false, false],
    [true, false, true, false],
    [true, true, true, true],
    [false, true, true, false],
  ])(
    "requires paired intent metadata exactly when the RUN binds a Task (%s/%s/%s)",
    async (taskBound, intentHash, queryHash, accepted) => {
      const { snapshot, packageDocument: original } = await fixture();
      const { receipt_hash: _retrievalHash, ...retrieval } = original.retrieval_receipt;
      const retrievalReceipt = await buildSemanticRetrievalReceipt({
        ...retrieval,
        ...(intentHash ? { intent_context_hash: hash("a") } : {}),
        ...(queryHash ? { retrieval_query_hash: hash("b") } : {}),
      });
      const { receipt_hash: _inferenceHash, ...inference } = original.inference_receipt;
      const inferenceReceipt = await buildSemanticInferenceReceipt({
        ...inference,
        retrieval_receipt_hash: retrievalReceipt.receipt_hash,
      });
      const {
        package_id: _id,
        package_hash: _hash,
        package_key_hash: _key,
        ...material
      } = original;
      const packageDocument = await buildSemanticContextPackage({
        ...material,
        retrieval_receipt: retrievalReceipt,
        inference_receipt: inferenceReceipt,
      });
      const request = await buildSemanticContextRequest({
        schema_version: "semantic-context-request@1.0.0",
        request_id: id(30),
        scope,
        basis: {
          consumer: "RUN",
          run_id: id(31),
          config_ref: { config_id: id(32), config_revision: 1, config_hash: hash("c") },
          context_receipt_ref: { receipt_id: id(33), receipt_hash: hash("d") },
          ...(taskBound
            ? {
                provider_task_ref: {
                  ...scope,
                  artifact_id: id(34),
                  artifact_type: "ProviderTaskArtifact",
                  run_id: id(31),
                  revision: 1,
                  content_hash: hash("e"),
                },
              }
            : {}),
        },
      });
      const receipt = await buildSemanticContextReceipt({
        schema_version: "semantic-context-receipt@1.0.0",
        receipt_id: id(30),
        scope,
        consumer: "RUN",
        run_id: id(31),
        request_id: request.request_id,
        request_hash: request.request_hash,
        package_ref: {
          package_id: packageDocument.package_id,
          package_revision: 1,
          package_hash: packageDocument.package_hash,
        },
        state: packageDocument.route_decision.state,
        route: packageDocument.route_decision.route,
        authority_snapshot_hash: snapshot.snapshot_hash,
        resolved_at: "2026-08-17T00:00:00.000Z",
      });
      const verified = verifySemanticContextCommitCommand({
        schema_version: "semantic-context-commit@1.0.0",
        request,
        authority_snapshot_hash: snapshot.snapshot_hash,
        package: packageDocument,
        receipt,
      });
      if (accepted) await expect(verified).resolves.toMatchObject({ request });
      else await expect(verified).rejects.toThrow("SEMANTIC_CONTEXT_COMMIT_CLOSURE_MISMATCH");
    },
  );

  it("builds the same package identity for preview and run consumers", async () => {
    const { snapshot, packageDocument } = await fixture();
    const {
      package_id: _packageId,
      package_key_hash: _packageKeyHash,
      package_hash: _packageHash,
      ...material
    } = packageDocument;
    const rebuilt = await buildSemanticContextPackage(material);
    expect(rebuilt).toEqual(packageDocument);

    const previewRequest = await buildSemanticContextRequest({
      schema_version: "semantic-context-request@1.0.0",
      request_id: id(21),
      scope,
      question: snapshot.question,
      basis: { consumer: "PREVIEW", defaults_ref: snapshot.defaults_ref },
    });
    const runRequest = await buildSemanticContextRequest({
      schema_version: "semantic-context-request@1.0.0",
      request_id: id(23),
      scope,
      basis: {
        consumer: "RUN",
        run_id: id(24),
        config_ref: { config_id: id(25), config_revision: 1, config_hash: hash("9") },
        context_receipt_ref: { receipt_id: id(26), receipt_hash: hash("a") },
      },
    });
    const preview = await buildSemanticContextReceipt({
      schema_version: "semantic-context-receipt@1.0.0",
      receipt_id: id(20),
      scope,
      consumer: "PREVIEW",
      request_id: previewRequest.request_id,
      request_hash: previewRequest.request_hash,
      run_id: null,
      package_ref: {
        package_id: packageDocument.package_id,
        package_revision: 1,
        package_hash: packageDocument.package_hash,
      },
      state: "READY",
      route: "METRIC",
      authority_snapshot_hash: packageDocument.authority_snapshot_hash,
      resolved_at: "2026-08-17T00:00:00.000Z",
    });
    const { receipt_hash: _receiptHash, ...previewDraft } = preview;
    const run = await buildSemanticContextReceipt({
      ...previewDraft,
      receipt_id: id(22),
      consumer: "RUN",
      request_id: runRequest.request_id,
      request_hash: runRequest.request_hash,
      run_id: id(24),
    });
    expect(preview.package_ref).toEqual(run.package_ref);
    expect(preview.receipt_hash).not.toBe(run.receipt_hash);
  });

  it("rejects tampered package hashes and cross-consumer commit splicing", async () => {
    const { snapshot, packageDocument } = await fixture();
    await expect(
      verifySemanticContextPackage({
        ...packageDocument,
        capacity: { ...packageDocument.capacity, included_bytes: 65 },
      }),
    ).rejects.toThrow();

    const previewRequest = await buildSemanticContextRequest({
      schema_version: "semantic-context-request@1.0.0",
      request_id: id(31),
      scope,
      question: snapshot.question,
      basis: { consumer: "PREVIEW", defaults_ref: snapshot.defaults_ref },
    });
    const receipt = await buildSemanticContextReceipt({
      schema_version: "semantic-context-receipt@1.0.0",
      receipt_id: id(30),
      scope,
      consumer: "PREVIEW",
      request_id: previewRequest.request_id,
      request_hash: previewRequest.request_hash,
      run_id: null,
      package_ref: {
        package_id: packageDocument.package_id,
        package_revision: 1,
        package_hash: packageDocument.package_hash,
      },
      state: "READY",
      route: "METRIC",
      authority_snapshot_hash: snapshot.snapshot_hash,
      resolved_at: "2026-08-17T00:00:00.000Z",
    });
    const runRequest = await buildSemanticContextRequest({
      schema_version: "semantic-context-request@1.0.0",
      request_id: id(31),
      scope,
      basis: {
        consumer: "RUN",
        run_id: id(32),
        config_ref: { config_id: id(33), config_revision: 1, config_hash: hash("9") },
        context_receipt_ref: { receipt_id: id(34), receipt_hash: hash("a") },
      },
    });
    await expect(
      verifySemanticContextCommitCommand({
        schema_version: "semantic-context-commit@1.0.0",
        request: runRequest,
        authority_snapshot_hash: snapshot.snapshot_hash,
        package: packageDocument,
        receipt,
      }),
    ).rejects.toThrow("SEMANTIC_CONTEXT_COMMIT_CLOSURE_MISMATCH");
  });

  it("closes request, package key, derived package id, and receipt identities", async () => {
    const { snapshot, packageDocument } = await fixture();
    const request = await buildSemanticContextRequest({
      schema_version: "semantic-context-request@1.0.0",
      request_id: id(40),
      scope,
      question: snapshot.question,
      basis: { consumer: "PREVIEW", defaults_ref: snapshot.defaults_ref },
    });
    await expect(
      verifySemanticContextRequest({ ...request, question: `${snapshot.question}?` }),
    ).rejects.toThrow("SEMANTIC_CONTEXT_REQUEST_HASH_MISMATCH");
    await expect(
      verifySemanticContextPackage({ ...packageDocument, package_key_hash: hash("f") }),
    ).rejects.toThrow("SEMANTIC_CONTEXT_PACKAGE_HASH_MISMATCH");
    await expect(
      verifySemanticContextPackage({ ...packageDocument, package_id: id(41) }),
    ).rejects.toThrow("SEMANTIC_CONTEXT_PACKAGE_HASH_MISMATCH");

    const receipt = await buildSemanticContextReceipt({
      schema_version: "semantic-context-receipt@1.0.0",
      receipt_id: id(42),
      scope,
      consumer: "PREVIEW",
      request_id: request.request_id,
      request_hash: request.request_hash,
      run_id: null,
      package_ref: {
        package_id: packageDocument.package_id,
        package_revision: 1,
        package_hash: packageDocument.package_hash,
      },
      state: packageDocument.route_decision.state,
      route: packageDocument.route_decision.route,
      authority_snapshot_hash: snapshot.snapshot_hash,
      resolved_at: "2026-08-17T00:00:00.000Z",
    });
    const { receipt_hash: _receiptHash, ...receiptDraft } = receipt;
    const splicedReceipt = await buildSemanticContextReceipt({
      ...receiptDraft,
      request_hash: hash("e"),
    });
    await expect(
      verifySemanticContextCommitCommand({
        schema_version: "semantic-context-commit@1.0.0",
        request,
        authority_snapshot_hash: snapshot.snapshot_hash,
        package: packageDocument,
        receipt: splicedReceipt,
      }),
    ).rejects.toThrow("SEMANTIC_CONTEXT_COMMIT_CLOSURE_MISMATCH");
  });

  it("rejects non-canonical authority, release/snapshot drift, and forged capacity totals", async () => {
    const { snapshot, packageDocument } = await fixture();
    const {
      snapshot_hash: _snapshotHash,
      question_hash: _questionHash,
      ...snapshotInput
    } = snapshot;
    await expect(
      buildSemanticContextAuthoritySnapshot({
        ...snapshotInput,
        published_metrics: [
          { ...snapshot.published_metrics[0], metric_id: "z_metric" },
          { ...snapshot.published_metrics[0], metric_id: "a_metric" },
        ],
      }),
    ).rejects.toThrow();
    await expect(
      buildSemanticContextAuthoritySnapshot({
        ...snapshotInput,
        schema_snapshot: { ...snapshot.schema_snapshot, semantic_generation: 9 },
      }),
    ).rejects.toThrow();
    const {
      package_id: _id,
      package_key_hash: _key,
      package_hash: _hash,
      ...material
    } = packageDocument;
    await expect(
      buildSemanticContextPackage({
        ...material,
        capacity: { ...material.capacity, included_bytes: material.capacity.included_bytes + 1 },
      }),
    ).rejects.toThrow();
  });
});
