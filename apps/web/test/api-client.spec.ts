import { afterEach, describe, expect, it, vi } from "vitest";
import { createQaRun } from "../src/lib/api-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("workspace API client errors", () => {
  it("preserves the standard server error code and public message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "AGENT_PROFILE_SET_NOT_READY",
              message: "Three enabled Agent Profiles are required before starting a Team Run.",
              retryable: false,
            },
          },
          { status: 400 },
        ),
      ),
    );

    await expect(
      createQaRun(
        "How many tables are available?",
        "00000000-0000-4000-8000-000000000010",
        "00000000-0000-4000-8000-000000000011",
      ),
    ).rejects.toMatchObject({
      name: "ApiRequestError",
      status: 400,
      code: "AGENT_PROFILE_SET_NOT_READY",
      retryable: false,
      message:
        "Three enabled Agent Profiles are required before starting a Team Run. (AGENT_PROFILE_SET_NOT_READY)",
    });
  });

  it("falls back to a status-only error for malformed responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("upstream exploded", { status: 502 })),
    );

    await expect(
      createQaRun(
        "How many tables are available?",
        "00000000-0000-4000-8000-000000000010",
        "00000000-0000-4000-8000-000000000011",
      ),
    ).rejects.toMatchObject({
      name: "ApiRequestError",
      status: 502,
      code: null,
      retryable: null,
      message: "API 请求失败 (502)",
    });
  });
});
