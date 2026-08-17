import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  handleCompileSemanticCandidate,
  handleSubmitSemanticCandidateCompile,
} from "../src/lib/semantic-candidate-route";
import type { SemanticCandidateRuntime } from "../src/lib/semantic-candidate-runtime";

const ids = {
  snapshot: "00000000-0000-4000-8000-000000000001",
  idempotency: "00000000-0000-4000-8000-000000000002",
  compile: "00000000-0000-4000-8000-000000000003",
  operation: "00000000-0000-4000-8000-000000000004",
} as const;

function runtime() {
  const authority = {
    authority: "POSTGRESQL" as const,
    capabilityInput: { server: "capability" },
    scope: {
      appId: ids.snapshot,
      tenantId: ids.idempotency,
      environment: "test",
      semanticDomain: "commerce",
    },
    deploymentId: ids.compile,
    principal: ids.operation,
    semanticRole: "human-reviewer" as const,
    allowedDomains: ["commerce"],
  };
  const compile = vi.fn(async () => ({
    ok: true as const,
    value: { compile_run_id: ids.compile, terminal: "AGENT_UNAVAILABLE" },
  }));
  const submit = vi.fn(async () => ({
    ok: true as const,
    value: { candidate_id: ids.snapshot, revision_id: ids.idempotency },
  }));
  const value = {
    authorityResolver: { resolve: vi.fn(async () => authority) },
    service: { compile, submit, get: vi.fn() },
  } as unknown as SemanticCandidateRuntime;
  return { value, authority, compile, submit };
}

describe("semantic candidate compile routes", () => {
  it("rejects client-supplied authority and model identity before dispatch", async () => {
    for (const forbidden of [
      { tenant_id: "attacker" },
      { principal: "attacker" },
      { model_id: "untrusted-model" },
      { snapshot_digest: `sha256:${"a".repeat(64)}` },
    ]) {
      const test = runtime();
      const response = await handleCompileSemanticCandidate(
        new Request("http://localhost/api/semantic/candidate-compiles", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            schema_version: "semantic-compile-request@1.0.0",
            semantic_domain: "commerce",
            snapshot_id: ids.snapshot,
            idempotency_key: ids.idempotency,
            ...forbidden,
          }),
        }),
        test.value,
      );
      expect(response.status).toBe(400);
      expect(test.value.authorityResolver.resolve).not.toHaveBeenCalled();
      expect(test.compile).not.toHaveBeenCalled();
    }
  });

  it("resolves write authority and returns an explicitly unpublished compile", async () => {
    const test = runtime();
    const input = {
      schema_version: "semantic-compile-request@1.0.0" as const,
      semantic_domain: "commerce",
      snapshot_id: ids.snapshot,
      idempotency_key: ids.idempotency,
    };
    const response = await handleCompileSemanticCandidate(
      new Request("http://localhost/api/semantic/candidate-compiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
      test.value,
    );
    expect(response.status).toBe(201);
    expect(test.value.authorityResolver.resolve).toHaveBeenCalledWith({
      access: "WRITE",
      semanticDomain: "commerce",
    });
    expect(test.compile).toHaveBeenCalledWith(test.authority, input);
    await expect(response.json()).resolves.toMatchObject({
      meta: { authority: "POSTGRESQL", publication_state: "UNPUBLISHED_CANDIDATE" },
    });
  });

  it("binds submit identity to the path and strict body", async () => {
    const test = runtime();
    const response = await handleSubmitSemanticCandidateCompile(
      new Request(`http://localhost/api/semantic/candidate-compiles/${ids.compile}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schema_version: "semantic-compile-submit@1.0.0",
          semantic_domain: "commerce",
          selected_operation_ids: [ids.operation],
          idempotency_key: ids.idempotency,
        }),
      }),
      Promise.resolve({ compileRunId: ids.compile }),
      test.value,
    );
    expect(response.status).toBe(201);
    expect(test.submit).toHaveBeenCalledWith(test.authority, {
      semantic_domain: "commerce",
      compile_run_id: ids.compile,
      selected_operation_ids: [ids.operation],
      idempotency_key: ids.idempotency,
    });
  });

  it("redacts unexpected provider failures", async () => {
    const test = runtime();
    test.compile.mockRejectedValueOnce(new Error("api_key=raw-secret host=db.internal"));
    const response = await handleCompileSemanticCandidate(
      new Request("http://localhost/api/semantic/candidate-compiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schema_version: "semantic-compile-request@1.0.0",
          semantic_domain: "commerce",
          snapshot_id: ids.snapshot,
          idempotency_key: ids.idempotency,
        }),
      }),
      test.value,
    );
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(JSON.stringify(body)).not.toContain("raw-secret");
    expect(JSON.stringify(body)).not.toContain("db.internal");
  });
});
