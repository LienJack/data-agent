import { describe, expect, it } from "vitest";
import {
  buildResolvedContextAuthoritySnapshot,
  buildResolvedContextPackage,
  buildResolvedContextReceipt,
  buildResolvedContextRequest,
  verifyResolvedContextCommitCommand,
  verifyResolvedContextPackage,
  verifyResolvedContextRequest,
} from "../src/context/resolved-context-package.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "development" } as const;

async function fixture() {
  const snapshot = await buildResolvedContextAuthoritySnapshot({
    schema_version: "resolved-context-authority-snapshot@2.0.0",
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
  const packageDocument = await buildResolvedContextPackage({
    schema_version: "resolved-context-package@2.0.0",
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
      schema_version: "resolved-context-route-decision@2.0.0",
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
  });
  return { snapshot, packageDocument };
}

describe("resolved context package contracts", () => {
  it("builds the same package identity for preview and run consumers", async () => {
    const { snapshot, packageDocument } = await fixture();
    const {
      package_id: _packageId,
      package_key_hash: _packageKeyHash,
      package_hash: _packageHash,
      ...material
    } = packageDocument;
    const rebuilt = await buildResolvedContextPackage(material);
    expect(rebuilt).toEqual(packageDocument);

    const previewRequest = await buildResolvedContextRequest({
      schema_version: "resolved-context-request@1.0.0",
      request_id: id(21),
      scope,
      question: snapshot.question,
      basis: { consumer: "PREVIEW", defaults_ref: snapshot.defaults_ref },
    });
    const runRequest = await buildResolvedContextRequest({
      schema_version: "resolved-context-request@1.0.0",
      request_id: id(23),
      scope,
      basis: {
        consumer: "RUN",
        run_id: id(24),
        config_ref: { config_id: id(25), config_revision: 1, config_hash: hash("9") },
        context_receipt_ref: { receipt_id: id(26), receipt_hash: hash("a") },
      },
    });
    const preview = await buildResolvedContextReceipt({
      schema_version: "resolved-context-receipt@1.0.0",
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
    const run = await buildResolvedContextReceipt({
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
      verifyResolvedContextPackage({
        ...packageDocument,
        capacity: { ...packageDocument.capacity, included_bytes: 65 },
      }),
    ).rejects.toThrow();

    const previewRequest = await buildResolvedContextRequest({
      schema_version: "resolved-context-request@1.0.0",
      request_id: id(31),
      scope,
      question: snapshot.question,
      basis: { consumer: "PREVIEW", defaults_ref: snapshot.defaults_ref },
    });
    const receipt = await buildResolvedContextReceipt({
      schema_version: "resolved-context-receipt@1.0.0",
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
    const runRequest = await buildResolvedContextRequest({
      schema_version: "resolved-context-request@1.0.0",
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
      verifyResolvedContextCommitCommand({
        schema_version: "resolved-context-commit@1.0.0",
        request: runRequest,
        authority_snapshot_hash: snapshot.snapshot_hash,
        package: packageDocument,
        receipt,
      }),
    ).rejects.toThrow("RESOLVED_CONTEXT_COMMIT_CLOSURE_MISMATCH");
  });

  it("closes request, package key, derived package id, and receipt identities", async () => {
    const { snapshot, packageDocument } = await fixture();
    const request = await buildResolvedContextRequest({
      schema_version: "resolved-context-request@1.0.0",
      request_id: id(40),
      scope,
      question: snapshot.question,
      basis: { consumer: "PREVIEW", defaults_ref: snapshot.defaults_ref },
    });
    await expect(
      verifyResolvedContextRequest({ ...request, question: `${snapshot.question}?` }),
    ).rejects.toThrow("RESOLVED_CONTEXT_REQUEST_HASH_MISMATCH");
    await expect(
      verifyResolvedContextPackage({ ...packageDocument, package_key_hash: hash("f") }),
    ).rejects.toThrow("RESOLVED_CONTEXT_PACKAGE_HASH_MISMATCH");
    await expect(
      verifyResolvedContextPackage({ ...packageDocument, package_id: id(41) }),
    ).rejects.toThrow("RESOLVED_CONTEXT_PACKAGE_HASH_MISMATCH");

    const receipt = await buildResolvedContextReceipt({
      schema_version: "resolved-context-receipt@1.0.0",
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
    const splicedReceipt = await buildResolvedContextReceipt({
      ...receiptDraft,
      request_hash: hash("e"),
    });
    await expect(
      verifyResolvedContextCommitCommand({
        schema_version: "resolved-context-commit@1.0.0",
        request,
        authority_snapshot_hash: snapshot.snapshot_hash,
        package: packageDocument,
        receipt: splicedReceipt,
      }),
    ).rejects.toThrow("RESOLVED_CONTEXT_COMMIT_CLOSURE_MISMATCH");
  });

  it("rejects non-canonical authority, release/snapshot drift, and forged capacity totals", async () => {
    const { snapshot, packageDocument } = await fixture();
    const {
      snapshot_hash: _snapshotHash,
      question_hash: _questionHash,
      ...snapshotInput
    } = snapshot;
    await expect(
      buildResolvedContextAuthoritySnapshot({
        ...snapshotInput,
        published_metrics: [
          { ...snapshot.published_metrics[0], metric_id: "z_metric" },
          { ...snapshot.published_metrics[0], metric_id: "a_metric" },
        ],
      }),
    ).rejects.toThrow();
    await expect(
      buildResolvedContextAuthoritySnapshot({
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
      buildResolvedContextPackage({
        ...material,
        capacity: { ...material.capacity, included_bytes: material.capacity.included_bytes + 1 },
      }),
    ).rejects.toThrow();
  });
});
