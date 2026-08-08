import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { publicSemanticGovernanceError } from "../src/lib/semantic-governance-error";
import {
  parseSemanticCandidateRequest,
  parseSemanticPublishRequest,
  parseSemanticRollbackRequest,
  semanticRouteErrorResponse,
} from "../src/lib/semantic-governance-route";

const id = "00000000-0000-4000-8000-000000000001";
const hash = `sha256:${"a".repeat(64)}`;

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof Error && "code" in error
      ? String((error as Error & { code: unknown }).code)
      : undefined;
  }
}

describe("semantic governance route material gates", () => {
  it("rejects incomplete candidate input with the candidate error before dispatch", () => {
    expect(
      codeOf(() =>
        parseSemanticCandidateRequest({
          schema_version: "semantic-candidate-draft@1.0.0",
          semantic_domain: "revenue",
        }),
      ),
    ).toBe("SEMANTIC_CANDIDATE_INVALID");
  });

  it("rejects incomplete publish material before dispatch", () => {
    const dispatch = vi.fn();
    expect(
      codeOf(() => {
        const parsed = parseSemanticPublishRequest({
          action: "prepare",
          input: {
            schema_version: "semantic-prepare-publish@1.0.0",
            semantic_domain: "revenue",
            packet_id: id,
          },
        });
        dispatch(parsed);
      }),
    ).toBe("SEMANTIC_PUBLISH_MATERIAL_REQUIRED");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects incomplete rollback authorization before dispatch", () => {
    const dispatch = vi.fn();
    expect(
      codeOf(() => {
        const parsed = parseSemanticRollbackRequest({
          schema_version: "semantic-rollback@1.0.0",
          semantic_domain: "revenue",
          packet_id: id,
        });
        dispatch(parsed);
      }),
    ).toBe("SEMANTIC_ROLLBACK_AUTHORIZATION_REQUIRED");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("preserves valid publish material exactly", () => {
    const request = {
      action: "prepare",
      input: {
        schema_version: "semantic-prepare-publish@1.0.0",
        semantic_domain: "revenue",
        packet_id: id,
        compiler_bundle_digest: hash,
        catalog_epoch: 7,
        dependency_generation: 11,
        target_generation: 12,
        idempotency_digest: hash,
        conditional_legacy_plan: { mode: "exact" },
      },
    } as const;

    expect(parseSemanticPublishRequest(request)).toEqual(request);
  });

  it("never exposes an unknown cause in the public response", async () => {
    const cause = Object.assign(
      new Error("postgresql://reader:raw-secret@db.internal/analytics token=abc"),
      { code: "XX000" },
    );
    const response = semanticRouteErrorResponse(cause, "INVALID_BODY");
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: {
        code: "SEMANTIC_GOVERNANCE_UNAVAILABLE",
        message: "语义治理服务暂时不可用。",
        retryable: true,
      },
    });
    expect(JSON.stringify(body)).not.toContain("raw-secret");
    expect(JSON.stringify(body)).not.toContain("db.internal");
    expect(JSON.stringify(body)).not.toContain("token=abc");
  });

  it("preserves the stable packet-not-found response", async () => {
    const response = semanticRouteErrorResponse(
      publicSemanticGovernanceError("SEMANTIC_PACKET_NOT_FOUND"),
      "INVALID_PARAMS",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "SEMANTIC_PACKET_NOT_FOUND",
        message: "语义审核包不存在。",
        retryable: false,
      },
    });
  });
});
