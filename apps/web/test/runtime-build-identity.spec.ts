import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadRuntimeBuildIdentity,
  RUNTIME_BUILD_IDENTITY_VERSION,
  type RuntimeBuildIdentity,
  type RuntimeBuildIdentityConfigurationError,
} from "@data-agent/contracts/server";
import { afterEach, describe, expect, it } from "vitest";
import {
  getWebRuntimeBuildIdentity,
  resetWebRuntimeBuildIdentityForTest,
  setWebRuntimeBuildIdentityForTest,
} from "../src/lib/runtime-build-identity.js";

const temporaryRoots: string[] = [];

function identity(role: RuntimeBuildIdentity["consumer_role"] = "web"): RuntimeBuildIdentity {
  return {
    schema_version: RUNTIME_BUILD_IDENTITY_VERSION,
    consumer_role: role,
    generation_id: `sha256:${"a".repeat(64)}`,
    build_id: `sha256:${"b".repeat(64)}`,
    built_at: "2026-08-22T00:00:00.000Z",
    git_commit: "c".repeat(40),
    git_dirty: true,
  };
}

afterEach(async () => {
  resetWebRuntimeBuildIdentityForTest();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("Web runtime build identity", () => {
  it("从受控绝对路径加载 strict Web identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "web-runtime-identity-"));
    temporaryRoots.push(root);
    await mkdir(root, { recursive: true });
    const path = join(root, "identity.json");
    await writeFile(path, JSON.stringify(identity()));

    expect(
      loadRuntimeBuildIdentity({
        expectedRole: "web",
        environment: { DATA_AGENT_RUNTIME_BUILD_IDENTITY_FILE: path },
      }),
    ).toEqual(identity());
  });

  it("missing、malformed 与 role mismatch 使用稳定配置错误", async () => {
    expect(() => loadRuntimeBuildIdentity({ expectedRole: "web", environment: {} })).toThrowError(
      expect.objectContaining<Partial<RuntimeBuildIdentityConfigurationError>>({
        code: "RUNTIME_BUILD_IDENTITY_MISSING",
      }),
    );

    const root = await mkdtemp(join(tmpdir(), "web-runtime-identity-"));
    temporaryRoots.push(root);
    const path = join(root, "identity.json");
    await writeFile(path, "{");
    expect(() =>
      loadRuntimeBuildIdentity({
        expectedRole: "web",
        environment: { DATA_AGENT_RUNTIME_BUILD_IDENTITY_FILE: path },
      }),
    ).toThrowError(expect.objectContaining({ code: "RUNTIME_BUILD_IDENTITY_INVALID" }));

    await writeFile(path, JSON.stringify(identity("worker")));
    expect(() =>
      loadRuntimeBuildIdentity({
        expectedRole: "web",
        environment: { DATA_AGENT_RUNTIME_BUILD_IDENTITY_FILE: path },
      }),
    ).toThrowError(expect.objectContaining({ code: "RUNTIME_BUILD_IDENTITY_ROLE_MISMATCH" }));
  });

  it("显式 test harness 固定 identity，读取不会随轮询变化", () => {
    setWebRuntimeBuildIdentityForTest(identity());
    expect(getWebRuntimeBuildIdentity()).toBe(getWebRuntimeBuildIdentity());
    expect(getWebRuntimeBuildIdentity()).toEqual(identity());
  });
});
