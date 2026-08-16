import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { fetchProviderModelCatalog } from "../src/lib/model-discovery";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("provider model discovery", () => {
  it("reads and normalizes an OpenAI-compatible model catalog", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          { id: "model-10", owned_by: "example" },
          { id: "model-2", owned_by: "example" },
          { id: "model-2", owned_by: "duplicate" },
        ],
      }),
    );

    const result = await fetchProviderModelCatalog(
      {
        vendorId: "openai",
        apiKey: "openai-secret",
        baseUrl: "https://api.example.test/v1/",
      },
      fetchImpl,
    );

    expect(result).toEqual([
      { id: "model-2", displayName: "model-2" },
      { id: "model-10", displayName: "model-10" },
    ]);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.example.test/v1/models");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer openai-secret");
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
  });

  it("uses Gemini query authentication and strips the resource-name prefix", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        models: [
          {
            name: "models/gemini-test",
            displayName: "Gemini Test",
            description: "Test model",
          },
        ],
      }),
    );

    const result = await fetchProviderModelCatalog(
      {
        vendorId: "gemini",
        apiKey: "gemini-secret",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      },
      fetchImpl,
    );

    expect(result).toEqual([
      { id: "gemini-test", displayName: "Gemini Test", description: "Test model" },
    ]);
    const [rawUrl, init] = fetchImpl.mock.calls[0] ?? [];
    const url = new URL(String(rawUrl));
    expect(url.pathname).toBe("/v1beta/models");
    expect(url.searchParams.get("key")).toBe("gemini-secret");
    expect(url.searchParams.get("pageSize")).toBe("1000");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
  });

  it("uses Anthropic model-list headers", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [{ id: "claude-test", display_name: "Claude Test" }],
        has_more: false,
      }),
    );

    await fetchProviderModelCatalog(
      {
        vendorId: "anthropic",
        apiKey: "anthropic-secret",
        baseUrl: "https://api.anthropic.com/v1",
      },
      fetchImpl,
    );

    const [rawUrl, init] = fetchImpl.mock.calls[0] ?? [];
    const url = new URL(String(rawUrl));
    const headers = new Headers(init?.headers);
    expect(url.pathname).toBe("/v1/models");
    expect(url.searchParams.get("limit")).toBe("1000");
    expect(headers.get("x-api-key")).toBe("anthropic-secret");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    expect(headers.has("authorization")).toBe(false);
  });

  it("blocks local and private discovery targets before making a request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      fetchProviderModelCatalog(
        {
          vendorId: "openai-compatible",
          apiKey: "secret",
          baseUrl: "https://127.0.0.1:9000/v1",
        },
        fetchImpl,
      ),
    ).rejects.toMatchObject({
      code: "INVALID_DISCOVERY_URL",
      status: 400,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a stable credential error without echoing the secret", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 401));

    const discovery = fetchProviderModelCatalog(
      {
        vendorId: "siliconflow",
        apiKey: "do-not-echo-this-secret",
        baseUrl: "https://api.siliconflow.cn/v1",
      },
      fetchImpl,
    );

    await expect(discovery).rejects.toMatchObject({
      code: "MODEL_DISCOVERY_FAILED",
      message: "供应商拒绝访问，请检查 API Key 权限",
      status: 502,
    });
    await expect(discovery).rejects.not.toThrow("do-not-echo-this-secret");
  });
});
