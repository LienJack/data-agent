import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  handleSaveSemanticCandidateRevision,
  handleSelfPublishSemanticCandidate,
} from "../src/lib/semantic-candidate-save-route";
import type { SemanticCandidateSaveService } from "../src/lib/semantic-candidate-save-service";

const ids = {
  run: "10000000-0000-4000-8000-000000000001",
  candidate: "10000000-0000-4000-8000-000000000002",
  candidateRevision: "10000000-0000-4000-8000-000000000003",
  sourceRevision: "10000000-0000-4000-8000-000000000004",
  key: "10000000-0000-4000-8000-000000000005",
} as const;

describe("Semantic explicit revision routes", () => {
  it("does not materialize a Revision until the explicit save route is called", async () => {
    const save = vi.fn(async () => ({
      ok: true as const,
      value: {
        schema_version: "semantic-candidate-revision-save-result@1.0.0" as const,
        disposition: "CREATED" as const,
        candidate_id: ids.candidate,
        source_revision_id: ids.sourceRevision,
        candidate_revision_id: ids.candidateRevision,
        revision_number: 1,
        final_graph_digest: `sha256:${"1".repeat(64)}` as const,
        validation_receipt_digest: `sha256:${"2".repeat(64)}` as const,
        saved_at: "2026-08-22T00:00:00.000Z",
      },
    }));
    const service = { save } as unknown as SemanticCandidateSaveService;
    expect(save).not.toHaveBeenCalled();
    const response = await handleSaveSemanticCandidateRevision(
      new NextRequest("http://localhost/semantic/studio/candidate-revisions", {
        method: "POST",
        body: JSON.stringify({
          schema_version: "semantic-candidate-revision-save-request@1.0.0",
          semantic_domain: "ecommerce",
          authoring_run_id: ids.run,
          expected_working_revision: 2,
          expected_graph_digest: `sha256:${"3".repeat(64)}`,
          manual_edits: [],
          evidence_selection_refs: [],
          summary: "保存候选版本",
          idempotency_key: ids.key,
        }),
      }),
      service,
    );
    expect(response.status).toBe(201);
    expect(save).toHaveBeenCalledTimes(1);
    expect((await response.json()).meta.mutation).toBe("EXPLICIT_SAVE");
  });

  it("passes only an exact saved revision into creator self-review publishing", async () => {
    const selfPublish = vi.fn(async () => ({
      ok: true as const,
      value: {
        schema_version: "semantic-candidate-self-publish-result@1.0.0" as const,
        disposition: "PUBLISHED" as const,
      },
    }));
    const service = { selfPublish } as unknown as SemanticCandidateSaveService;
    const response = await handleSelfPublishSemanticCandidate(
      new NextRequest("http://localhost/semantic/studio/self-publish", {
        method: "POST",
        body: JSON.stringify({
          schema_version: "semantic-candidate-self-publish-request@1.0.0",
          semantic_domain: "ecommerce",
          authoring_run_id: ids.run,
          candidate_id: ids.candidate,
          candidate_revision_id: ids.candidateRevision,
          revision_number: 1,
          source_revision_id: ids.sourceRevision,
          review_reason: "创建者审核通过",
          idempotency_key: ids.key,
        }),
      }),
      service,
    );
    expect(response.status).toBe(201);
    expect((await response.clone().json()).meta.mutation).toBe("SELF_REVIEW_AND_PUBLISH");
    expect(selfPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate_revision_id: ids.candidateRevision,
        source_revision_id: ids.sourceRevision,
        review_reason: "创建者审核通过",
      }),
    );
  });

  it("rejects publish input that does not identify an immutable saved revision", async () => {
    const selfPublish = vi.fn();
    const service = { selfPublish } as unknown as SemanticCandidateSaveService;
    const response = await handleSelfPublishSemanticCandidate(
      new NextRequest("http://localhost/semantic/studio/self-publish", {
        method: "POST",
        body: JSON.stringify({
          schema_version: "semantic-candidate-self-publish-request@1.0.0",
          semantic_domain: "ecommerce",
          candidate_id: ids.candidate,
          review_reason: "缺少 revision",
          idempotency_key: ids.key,
        }),
      }),
      service,
    );
    expect(response.status).toBe(400);
    expect(selfPublish).not.toHaveBeenCalled();
  });
});
