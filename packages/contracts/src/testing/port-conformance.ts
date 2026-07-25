import type { ArtifactReference } from "../artifacts/index.js";
import { canonicalizeJson, sha256ContentHash } from "../common/index.js";
import type {
  AppScope,
  CachePort,
  PortResult,
  QueuePort,
  SandboxExecutionRequest,
  SandboxPort,
  StoragePort,
} from "../ports/index.js";
import { sandboxExecutionReceiptSchema } from "../ports/index.js";

export interface PortConformanceHarness {
  readonly storage: StoragePort;
  readonly queue: QueuePort;
  readonly cache: CachePort;
  readonly sandbox: SandboxPort;
  readonly lease_duration_ms: number;
  now(): Date;
  advanceTimeBy(milliseconds: number): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

export type PortConformanceHarnessFactory = () =>
  | PortConformanceHarness
  | Promise<PortConformanceHarness>;

export interface PortConformanceCase {
  readonly name: string;
  run(createHarness: PortConformanceHarnessFactory): Promise<void>;
}

export class PortConformanceAssertionError extends Error {
  override readonly name = "PortConformanceAssertionError";
}

const ids = {
  appA: "00000000-0000-4000-8000-000000000001",
  appB: "00000000-0000-4000-8000-000000000002",
  tenantA: "00000000-0000-4000-8000-000000000003",
  tenantB: "00000000-0000-4000-8000-000000000004",
  run: "00000000-0000-4000-8000-000000000005",
  commandA: "00000000-0000-4000-8000-000000000006",
  commandB: "00000000-0000-4000-8000-000000000007",
  executionA: "00000000-0000-4000-8000-000000000008",
  executionB: "00000000-0000-4000-8000-000000000009",
  sqlArtifact: "00000000-0000-4000-8000-000000000010",
} as const;

const hashes = {
  artifact: `sha256:${"a".repeat(64)}`,
  input: `sha256:${"b".repeat(64)}`,
} as const;

const scope = {
  app_id: ids.appA,
  tenant_id: ids.tenantA,
  environment: "test",
} as const satisfies AppScope;

const otherScope = {
  app_id: ids.appB,
  tenant_id: ids.tenantB,
  environment: "test",
} as const satisfies AppScope;

function assertionFailure(message: string): never {
  throw new PortConformanceAssertionError(message);
}

function assertCanonicalEqual(actual: unknown, expected: unknown, context: string): void {
  const actualCanonical = canonicalizeJson(actual);
  const expectedCanonical = canonicalizeJson(expected);
  if (actualCanonical !== expectedCanonical) {
    assertionFailure(`${context}：预期 ${expectedCanonical}，实际 ${actualCanonical}。`);
  }
}

function assertEqual(
  actual: string | number | null | undefined,
  expected: string | number | null,
  context: string,
): void {
  if (!Object.is(actual, expected)) {
    assertionFailure(`${context}：预期 ${String(expected)}，实际 ${String(actual)}。`);
  }
}

function assertNotEqual(actual: string, unexpected: string, context: string): void {
  if (actual === unexpected) {
    assertionFailure(`${context}：不应等于 ${unexpected}。`);
  }
}

function assertGreaterThan(actual: number, lowerBound: number, context: string): void {
  if (actual <= lowerBound) {
    assertionFailure(`${context}：预期大于 ${lowerBound}，实际 ${actual}。`);
  }
}

function unwrap<T>(result: PortResult<T>, context: string): T {
  if (!result.ok) {
    assertionFailure(`${context}：预期成功，实际返回 ${result.error.code}。`);
  }
  return result.value;
}

function assertPortValue<T>(result: PortResult<T>, expected: unknown, context: string): void {
  assertCanonicalEqual(unwrap(result, context), expected, context);
}

function assertErrorCode(result: PortResult<unknown>, code: string, context: string): void {
  if (result.ok) {
    assertionFailure(`${context}：预期错误 ${code}，实际成功。`);
  }
  assertEqual(result.error.code, code, context);
}

function makeSqlArtifactReference(targetScope: AppScope, contentHash: string = hashes.input) {
  return {
    artifact_id: ids.sqlArtifact,
    artifact_type: "SqlArtifact",
    app_id: targetScope.app_id,
    tenant_id: targetScope.tenant_id,
    environment: targetScope.environment,
    run_id: ids.run,
    revision: 1,
    content_hash: contentHash,
  } as const satisfies ArtifactReference;
}

function makeSandboxRequest(input?: {
  readonly scope?: AppScope;
  readonly execution_id?: string;
  readonly idempotency_key?: string;
  readonly parameters?: Record<string, string | number>;
}): SandboxExecutionRequest {
  const requestScope = input?.scope ?? scope;
  return {
    schema_version: "1.0.0",
    scope: requestScope,
    run_id: ids.run,
    execution_id: input?.execution_id ?? ids.executionA,
    idempotency_key: input?.idempotency_key ?? "sandbox-once",
    language: "sql",
    payload: {
      dialect: "postgresql",
      sql_artifact_ref: makeSqlArtifactReference(requestScope),
      parameters: input?.parameters ?? {
        limit: 10,
        region: "south",
      },
    },
    budget: {
      timeout_ms: 1_000,
      max_rows: 10,
      max_bytes: 1_024,
      max_memory_mb: 64,
    },
  };
}

async function withHarness(
  createHarness: PortConformanceHarnessFactory,
  run: (harness: PortConformanceHarness) => void | Promise<void>,
): Promise<void> {
  const harness = await createHarness();
  try {
    await run(harness);
  } finally {
    await harness.dispose?.();
  }
}

function conformanceCase(
  name: string,
  run: (harness: PortConformanceHarness) => void | Promise<void>,
): PortConformanceCase {
  return Object.freeze({
    name,
    run: (createHarness: PortConformanceHarnessFactory) => withHarness(createHarness, run),
  });
}

export const PORT_CONFORMANCE_CASES: readonly PortConformanceCase[] = Object.freeze([
  conformanceCase("Storage 写入幂等、拒绝内容冲突并隔离调用方对象变更", async ({ storage }) => {
    const value = { answer: 42 };
    const input = {
      scope,
      key: "artifact/example",
      content_hash: hashes.artifact,
      value,
    };

    assertPortValue(await storage.put(input), { created: true }, "Storage 首次写入");
    assertPortValue(await storage.put(input), { created: false }, "Storage 幂等写入");
    assertErrorCode(
      await storage.put({ ...input, value: { answer: 43 } }),
      "STORAGE_CONTENT_CONFLICT",
      "Storage 不同内容冲突",
    );
    assertErrorCode(
      await storage.put({ ...input, content_hash: hashes.input }),
      "STORAGE_CONTENT_CONFLICT",
      "Storage 不同 Hash 冲突",
    );

    value.answer = 99;
    assertPortValue(
      await storage.get({ scope, key: input.key }),
      {
        content_hash: hashes.artifact,
        value: { answer: 42 },
      },
      "Storage 不受调用方对象变更影响",
    );
  }),
  conformanceCase("Queue 在 Lease 未过期时跳过 Command，到期后以新 Fence 接管", async (harness) => {
    const { queue } = harness;
    const command = {
      scope,
      command_id: ids.commandA,
      idempotency_key: "run-once",
      payload: { run_id: ids.run },
    };

    assertPortValue(
      await queue.enqueue(command),
      { command_id: ids.commandA, created: true },
      "Queue 首次入队",
    );
    assertPortValue(
      await queue.enqueue(command),
      { command_id: ids.commandA, created: false },
      "Queue 幂等入队",
    );
    assertErrorCode(
      await queue.enqueue({
        ...command,
        command_id: ids.commandB,
      }),
      "QUEUE_IDEMPOTENCY_CONFLICT",
      "Queue 同幂等键不能绑定不同 Command ID",
    );
    assertErrorCode(
      await queue.enqueue({
        ...command,
        payload: { run_id: ids.run, retry: true },
      }),
      "QUEUE_IDEMPOTENCY_CONFLICT",
      "Queue 同幂等键不能绑定不同规范 Payload",
    );

    const leaseStartedAt = harness.now().getTime();
    const firstLease = unwrap(
      await queue.lease({ scope, worker_id: "worker-a" }),
      "Queue 首次 Lease",
    );
    if (!firstLease) {
      assertionFailure("Queue 首次 Lease 必须存在。");
    }
    assertEqual(
      firstLease.expires_at,
      new Date(leaseStartedAt + harness.lease_duration_ms).toISOString(),
      "Queue Lease 到期时间",
    );
    assertPortValue(
      await queue.lease({ scope, worker_id: "worker-b" }),
      null,
      "活动 Command 不可重复 Lease",
    );

    await harness.advanceTimeBy(harness.lease_duration_ms - 1);
    assertPortValue(
      await queue.lease({ scope, worker_id: "worker-b" }),
      null,
      "Lease 到期前一毫秒仍然活动",
    );
    await harness.advanceTimeBy(1);

    assertErrorCode(
      await queue.ack({
        scope,
        lease_id: firstLease.lease_id,
        fencing_token: firstLease.fencing_token,
      }),
      "QUEUE_STALE_FENCE",
      "到期 Lease 不能确认",
    );
    const takeover = unwrap(await queue.lease({ scope, worker_id: "worker-b" }), "Queue 到期接管");
    if (!takeover) {
      assertionFailure("Lease 到期后必须允许接管。");
    }
    assertEqual(takeover.command_id, firstLease.command_id, "Queue 接管同一个 Command");
    assertGreaterThan(takeover.fencing_token, firstLease.fencing_token, "Queue 接管使用更高 Fence");

    assertErrorCode(
      await queue.ack({
        scope,
        lease_id: "wrong-lease",
        fencing_token: takeover.fencing_token,
      }),
      "QUEUE_LEASE_MISMATCH",
      "Queue 拒绝错误 Lease ID",
    );
    assertErrorCode(
      await queue.ack({
        scope: otherScope,
        lease_id: takeover.lease_id,
        fencing_token: takeover.fencing_token,
      }),
      "QUEUE_STALE_FENCE",
      "Queue 拒绝跨 Scope Ack",
    );
    assertPortValue(
      await queue.ack({
        scope,
        lease_id: takeover.lease_id,
        fencing_token: takeover.fencing_token,
      }),
      { acknowledged: true },
      "Queue 当前 Lease Ack",
    );
    assertErrorCode(
      await queue.ack({
        scope,
        lease_id: takeover.lease_id,
        fencing_token: takeover.fencing_token,
      }),
      "QUEUE_STALE_FENCE",
      "Queue 拒绝重复 Ack",
    );
    assertPortValue(await queue.lease({ scope, worker_id: "worker-c" }), null, "Queue Ack 后为空");
  }),
  conformanceCase(
    "Queue 可以并行租用不同 Command，但不会重复租用活动 Command",
    async ({ queue }) => {
      unwrap(
        await queue.enqueue({
          scope,
          command_id: ids.commandA,
          idempotency_key: "command-a",
          payload: "a",
        }),
        "Queue Command A 入队",
      );
      unwrap(
        await queue.enqueue({
          scope,
          command_id: ids.commandB,
          idempotency_key: "command-b",
          payload: "b",
        }),
        "Queue Command B 入队",
      );

      const first = unwrap(
        await queue.lease({ scope, worker_id: "worker-a" }),
        "Queue Command A Lease",
      );
      const second = unwrap(
        await queue.lease({ scope, worker_id: "worker-b" }),
        "Queue Command B Lease",
      );
      if (!first || !second) {
        assertionFailure("两个不同 Command 必须可以并行 Lease。");
      }
      assertEqual(first.command_id, ids.commandA, "Queue 首个 Command");
      assertEqual(second.command_id, ids.commandB, "Queue 第二个 Command");
    },
  ),
  conformanceCase("Cache 明确非权威，并在 TTL 边界过期", async (harness) => {
    const { cache } = harness;
    assertEqual(cache.authority, "NON_AUTHORITATIVE", "Cache 权威属性");
    assertErrorCode(
      await cache.set({
        scope,
        key: "invalid-projection",
        value: { version: 0 },
        ttl_seconds: 0,
      }),
      "CACHE_INVALID_TTL",
      "Cache 拒绝非正 TTL",
    );
    assertPortValue(
      await cache.set({
        scope,
        key: "projection",
        value: { version: 1 },
        ttl_seconds: 1,
      }),
      { stored: true },
      "Cache 写入",
    );
    assertPortValue(
      await cache.get({ scope, key: "projection" }),
      { version: 1 },
      "Cache 立即读取",
    );

    await harness.advanceTimeBy(999);
    assertPortValue(
      await cache.get({ scope, key: "projection" }),
      { version: 1 },
      "Cache 到期前读取",
    );
    await harness.advanceTimeBy(1);
    assertPortValue(await cache.get({ scope, key: "projection" }), null, "Cache 到期边界读取");
  }),
  conformanceCase("Sandbox 使用规范输入寻址，并实现幂等重放与冲突拒绝", async ({ sandbox }) => {
    const request = makeSandboxRequest();
    const firstReceipt = unwrap(await sandbox.execute(request), "Sandbox 首次执行");
    if (!sandboxExecutionReceiptSchema.safeParse(firstReceipt).success) {
      assertionFailure("Sandbox Receipt 必须符合公开 Schema。");
    }
    assertEqual(firstReceipt.input_hash, await sha256ContentHash(request), "Sandbox 规范输入 Hash");

    const reorderedRequest = makeSandboxRequest({
      parameters: {
        region: "south",
        limit: 10,
      },
    });
    assertPortValue(
      await sandbox.execute(reorderedRequest),
      firstReceipt,
      "Sandbox 相同规范输入重放",
    );

    assertErrorCode(
      await sandbox.execute(
        makeSandboxRequest({
          parameters: {
            limit: 11,
            region: "south",
          },
        }),
      ),
      "SANDBOX_IDEMPOTENCY_CONFLICT",
      "Sandbox 同键不同输入冲突",
    );

    const distinctReceipt = unwrap(
      await sandbox.execute(
        makeSandboxRequest({
          execution_id: ids.executionB,
          idempotency_key: "sandbox-twice",
          parameters: {
            limit: 11,
            region: "south",
          },
        }),
      ),
      "Sandbox 不同输入执行",
    );
    assertNotEqual(
      distinctReceipt.input_hash,
      firstReceipt.input_hash,
      "Sandbox 不同输入的 Input Hash",
    );
    assertNotEqual(
      distinctReceipt.execution_hash,
      firstReceipt.execution_hash,
      "Sandbox 不同输入的 Execution Hash",
    );
  }),
  conformanceCase(
    "所有 Port 都以 App/Tenant/Environment Scope 隔离相同 Key",
    async ({ storage, cache, queue, sandbox }) => {
      assertPortValue(
        await storage.put({
          scope,
          key: "shared-key",
          content_hash: hashes.artifact,
          value: "app-a",
        }),
        { created: true },
        "Storage App A 写入",
      );
      assertPortValue(
        await storage.put({
          scope: otherScope,
          key: "shared-key",
          content_hash: hashes.input,
          value: "app-b",
        }),
        { created: true },
        "Storage App B 写入",
      );
      assertPortValue(
        await storage.get({ scope, key: "shared-key" }),
        { content_hash: hashes.artifact, value: "app-a" },
        "Storage App A 读取",
      );
      assertPortValue(
        await storage.get({ scope: otherScope, key: "shared-key" }),
        { content_hash: hashes.input, value: "app-b" },
        "Storage App B 读取",
      );

      unwrap(
        await cache.set({
          scope,
          key: "shared-key",
          value: "app-a",
          ttl_seconds: 60,
        }),
        "Cache App A 写入",
      );
      unwrap(
        await cache.set({
          scope: otherScope,
          key: "shared-key",
          value: "app-b",
          ttl_seconds: 60,
        }),
        "Cache App B 写入",
      );
      assertPortValue(await cache.get({ scope, key: "shared-key" }), "app-a", "Cache App A 读取");
      assertPortValue(
        await cache.get({ scope: otherScope, key: "shared-key" }),
        "app-b",
        "Cache App B 读取",
      );

      unwrap(
        await queue.enqueue({
          scope,
          command_id: ids.commandA,
          idempotency_key: "shared-key",
          payload: "app-a",
        }),
        "Queue App A 入队",
      );
      unwrap(
        await queue.enqueue({
          scope: otherScope,
          command_id: ids.commandB,
          idempotency_key: "shared-key",
          payload: "app-b",
        }),
        "Queue App B 入队",
      );
      const appALease = unwrap(
        await queue.lease({ scope, worker_id: "worker-a" }),
        "Queue App A Lease",
      );
      const appBLease = unwrap(
        await queue.lease({ scope: otherScope, worker_id: "worker-b" }),
        "Queue App B Lease",
      );
      if (!appALease || !appBLease) {
        assertionFailure("两个 Scope 的 Queue Lease 都必须存在。");
      }
      assertEqual(appALease.command_id, ids.commandA, "Queue App A Command");
      assertCanonicalEqual(appALease.payload, "app-a", "Queue App A Payload");
      assertEqual(appBLease.command_id, ids.commandB, "Queue App B Command");
      assertCanonicalEqual(appBLease.payload, "app-b", "Queue App B Payload");

      const firstSandbox = unwrap(
        await sandbox.execute(makeSandboxRequest()),
        "Sandbox App A 执行",
      );
      const otherSandbox = unwrap(
        await sandbox.execute(
          makeSandboxRequest({
            scope: otherScope,
          }),
        ),
        "Sandbox App B 执行",
      );
      assertCanonicalEqual(otherSandbox.scope, otherScope, "Sandbox App B Scope");
      assertNotEqual(
        otherSandbox.input_hash,
        firstSandbox.input_hash,
        "Sandbox 跨 Scope Input Hash",
      );
    },
  ),
  conformanceCase("Scope 编码不会因 Environment 与 Key 的分隔符碰撞", async ({ storage }) => {
    const colonScope = {
      ...scope,
      environment: "test:shared",
    };

    assertPortValue(
      await storage.put({
        scope: colonScope,
        key: "key",
        content_hash: hashes.artifact,
        value: "colon-environment",
      }),
      { created: true },
      "包含分隔符的 Environment 写入",
    );
    assertPortValue(
      await storage.put({
        scope,
        key: "shared:key",
        content_hash: hashes.input,
        value: "colon-key",
      }),
      { created: true },
      "包含分隔符的 Key 写入",
    );
    assertPortValue(
      await storage.get({ scope: colonScope, key: "key" }),
      { content_hash: hashes.artifact, value: "colon-environment" },
      "包含分隔符的 Environment 读取",
    );
    assertPortValue(
      await storage.get({ scope, key: "shared:key" }),
      { content_hash: hashes.input, value: "colon-key" },
      "包含分隔符的 Key 读取",
    );
  }),
]);
