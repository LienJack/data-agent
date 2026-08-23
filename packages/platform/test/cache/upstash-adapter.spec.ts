import type { Redis } from "@upstash/redis";
import { describe, expect, it } from "vitest";
import { createUpstashRedisRestClient } from "../../src/cache/upstash-adapter.js";

describe("Upstash REST adapter", () => {
  it("uses expiring SET and exhausts cursor-based SCAN pages", async () => {
    const setCalls: unknown[][] = [];
    const cursors: Array<string | number> = [];
    const fake = {
      get: async () => "cached",
      set: async (...args: unknown[]) => {
        setCalls.push(args);
        return "OK" as const;
      },
      del: async () => 1,
      scan: async (cursor: string | number) => {
        cursors.push(cursor);
        return cursor === "0"
          ? (["8", ["da:a:test:projection:2"]] as [string, string[]])
          : (["0", ["da:a:test:projection:1"]] as [string, string[]]);
      },
    };
    const adapter = createUpstashRedisRestClient(fake as unknown as Redis);

    expect(await adapter.setex("key", 30, "value")).toBe("OK");
    expect(setCalls).toEqual([["key", "value", { ex: 30 }]]);
    expect(await adapter.scan("da:a:test:projection:*")).toEqual([
      "da:a:test:projection:1",
      "da:a:test:projection:2",
    ]);
    expect(cursors).toEqual(["0", "8"]);
  });
});
