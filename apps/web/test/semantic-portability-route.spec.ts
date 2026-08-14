import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { bindSemanticImportId, readSemanticJsonBody } from "../src/lib/semantic-portability-route";

describe("semantic portability route boundaries", () => {
  it("rejects an oversized body from Content-Length before reading it", async () => {
    const request = new Request("http://localhost/imports", {
      method: "POST",
      headers: { "content-length": String(2 * 1024 * 1024) },
      body: "{}",
    });
    const result = await readSemanticJsonBody(request);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected oversized request failure");
    expect(result.response.status).toBe(400);
    await expect(result.response.json()).resolves.toMatchObject({
      error: { code: "SEMANTIC_IMPORT_INPUT_INVALID" },
    });
  });

  it("returns a stable public error for malformed JSON", async () => {
    const result = await readSemanticJsonBody(
      new Request("http://localhost/imports", { method: "POST", body: "{" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected malformed JSON failure");
    await expect(result.response.json()).resolves.toMatchObject({
      error: { code: "SEMANTIC_IMPORT_INPUT_INVALID", retryable: false },
    });
  });

  it("binds the route import id instead of trusting a body id", () => {
    expect(
      bindSemanticImportId(
        { import_id: "body-id", schema_version: "semantic-import-command@1.0.0" },
        "route-id",
      ),
    ).toEqual({ import_id: "route-id", schema_version: "semantic-import-command@1.0.0" });
  });
});
