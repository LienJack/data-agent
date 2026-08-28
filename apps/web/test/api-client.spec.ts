import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createQaRun,
  fetchResolutionTrace,
  fetchResolutionTraceDetail,
} from "../src/lib/api-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("workspace API client errors", () => {
  it("projects a diagnostic browser claim to idempotency only", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ runId: "00000000-0000-4000-8000-000000000013" }, { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await createQaRun(
      "diagnostic question",
      "00000000-0000-4000-8000-000000000010",
      "00000000-0000-4000-8000-000000000011",
      [],
      {
        idempotency_key: "00000000-0000-4000-8000-000000000012",
        diagnostic_attempt_id: "00000000-0000-4000-8000-000000000014",
        run_id: "00000000-0000-4000-8000-000000000013",
      },
    );

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body.idempotency_key).toBe("00000000-0000-4000-8000-000000000012");
    expect(body).not.toHaveProperty("acceptance_fence");
    expect(body).not.toHaveProperty("diagnostic_attempt_id");
    expect(body).not.toHaveProperty("run_id");
  });

  it("maps malformed trace and detail payloads to stable authority errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: { schema_version: "resolution-trace@1.0.0" } }))
      .mockResolvedValueOnce(
        Response.json({ data: { schema_version: "resolution-trace-detail@3.0.0" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const workspaceId = "00000000-0000-4000-8000-000000000010";
    const runId = "00000000-0000-4000-8000-000000000011";

    await expect(fetchResolutionTrace(runId, workspaceId)).rejects.toMatchObject({
      name: "ApiRequestError",
      code: "RESOLUTION_TRACE_SCHEMA_INVALID",
      retryable: false,
    });
    await expect(
      fetchResolutionTraceDetail(
        runId,
        `event:00000000-0000-4000-8000-000000000012`,
        `sha256:${"a".repeat(64)}`,
        workspaceId,
      ),
    ).rejects.toMatchObject({
      name: "ApiRequestError",
      code: "RESOLUTION_TRACE_DETAIL_SCHEMA_INVALID",
      retryable: false,
    });
  });

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
