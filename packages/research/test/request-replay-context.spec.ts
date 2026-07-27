import { describe, expect, it, vi } from "vitest";
import {
  createResearchRequestReplayContext,
  isOwnedResearchReplayValue,
  memoizeSuccessfulResearchReplay,
  ownResearchReplayValue,
  snapshotResearchReplayMetrics,
} from "../src/internal/request-replay-context.js";

describe("request-local verified replay context", () => {
  it("只为同一 context 持有且递归冻结的对象复用成功结果", async () => {
    const context = createResearchRequestReplayContext();
    const input = ownResearchReplayValue(context, {
      document: { envelope: { content_hash: `sha256:${"1".repeat(64)}` } },
      derivation_input: { value: 1 },
    });
    const replay = vi.fn(async () => ({ ok: true as const, value: { verified: true } }));

    const first = await memoizeSuccessfulResearchReplay(context, "proof", input, replay);
    const second = await memoizeSuccessfulResearchReplay(context, "proof", input, replay);

    expect(first).toBe(second);
    expect(replay).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.value)).toBe(true);
    expect(isOwnedResearchReplayValue(context, first)).toBe(true);
    expect(snapshotResearchReplayMetrics(context)).toMatchObject({
      namespaces: {
        proof: { hits: 1, misses: 1, unowned: 0, failed: 0 },
      },
    });
  });

  it("跨 context、结构等价 clone 与 caller-claimed hash 都不能命中", async () => {
    const left = createResearchRequestReplayContext();
    const right = createResearchRequestReplayContext();
    const original = ownResearchReplayValue(left, {
      content_hash: `sha256:${"2".repeat(64)}`,
      assurance: { verifier: "identity-bound" },
    });
    const clone = ownResearchReplayValue(right, structuredClone(original));
    const replay = vi.fn(async () => ({ ok: true as const, value: "verified" }));

    await memoizeSuccessfulResearchReplay(left, "oed", original, replay);
    await memoizeSuccessfulResearchReplay(left, "oed", clone, replay);
    await memoizeSuccessfulResearchReplay(right, "oed", clone, replay);

    expect(replay).toHaveBeenCalledTimes(3);
    expect(snapshotResearchReplayMetrics(left)).toMatchObject({
      namespaces: {
        oed: { hits: 0, misses: 1, unowned: 1, failed: 0 },
      },
    });
    expect(snapshotResearchReplayMetrics(right)).toMatchObject({
      namespaces: {
        oed: { hits: 0, misses: 1, unowned: 0, failed: 0 },
      },
    });
  });

  it("冻结后不能 mutation，失败或异常结果不会进入缓存", async () => {
    const context = createResearchRequestReplayContext();
    const input = ownResearchReplayValue(context, {
      nested: { value: 1 },
    });
    expect(() => {
      (input.nested as { value: number }).value = 2;
    }).toThrow();

    const rejected = vi.fn(async () => ({ ok: false as const, error: "rejected" }));
    await memoizeSuccessfulResearchReplay(context, "failure", input, rejected);
    await memoizeSuccessfulResearchReplay(context, "failure", input, rejected);
    expect(rejected).toHaveBeenCalledTimes(2);

    const exceptional = vi.fn(async (): Promise<{ readonly ok: true }> => {
      throw new Error("boom");
    });
    await expect(
      memoizeSuccessfulResearchReplay(context, "exception", input, exceptional),
    ).rejects.toThrow("boom");
    await expect(
      memoizeSuccessfulResearchReplay(context, "exception", input, exceptional),
    ).rejects.toThrow("boom");
    expect(exceptional).toHaveBeenCalledTimes(2);
    expect(snapshotResearchReplayMetrics(context).totals.failed).toBe(4);
  });

  it("并发失败只合并 in-flight，不计成功命中；冻结发布异常后可以重试", async () => {
    const context = createResearchRequestReplayContext();
    const input = ownResearchReplayValue(context, { value: 1 });
    let releaseFailure: (() => void) | undefined;
    const failing = vi.fn(
      () =>
        new Promise<{ readonly ok: false; readonly error: string }>((resolve) => {
          releaseFailure = () => resolve({ ok: false, error: "rejected" });
        }),
    );

    const first = memoizeSuccessfulResearchReplay(context, "concurrent-failure", input, failing);
    const second = memoizeSuccessfulResearchReplay(context, "concurrent-failure", input, failing);
    await Promise.resolve();
    expect(releaseFailure).toBeTypeOf("function");
    releaseFailure?.();
    await expect(first).resolves.toMatchObject({ ok: false });
    await expect(second).resolves.toMatchObject({ ok: false });
    expect(failing).toHaveBeenCalledTimes(1);
    expect(snapshotResearchReplayMetrics(context).namespaces["concurrent-failure"]).toMatchObject({
      hits: 0,
      misses: 1,
      coalesced: 1,
      failed: 1,
    });

    const accessorResult = {};
    Object.defineProperty(accessorResult, "trap", {
      enumerable: true,
      get: () => "must not execute",
    });
    const publishing = vi
      .fn<() => Promise<{ readonly ok: true; readonly value: unknown }>>()
      .mockResolvedValueOnce({ ok: true, value: accessorResult })
      .mockResolvedValueOnce({ ok: true, value: { verified: true } });
    await expect(
      memoizeSuccessfulResearchReplay(context, "freeze-publication", input, publishing),
    ).rejects.toThrow("RESEARCH_REPLAY_CONTEXT_ONLY_ACCEPTS_DATA_PROPERTIES");
    await expect(
      memoizeSuccessfulResearchReplay(context, "freeze-publication", input, publishing),
    ).resolves.toMatchObject({ ok: true, value: { verified: true } });
    expect(publishing).toHaveBeenCalledTimes(2);

    const synchronousThrow = vi.fn((): Promise<{ readonly ok: true }> => {
      throw new Error("synchronous boom");
    });
    await expect(
      memoizeSuccessfulResearchReplay(context, "synchronous-throw", input, synchronousThrow),
    ).rejects.toThrow("synchronous boom");
    await expect(
      memoizeSuccessfulResearchReplay(context, "synchronous-throw", input, synchronousThrow),
    ).rejects.toThrow("synchronous boom");
    expect(synchronousThrow).toHaveBeenCalledTimes(2);
    expect(snapshotResearchReplayMetrics(context).namespaces["synchronous-throw"]).toMatchObject({
      hits: 0,
      misses: 2,
      coalesced: 0,
      failed: 2,
    });
  });

  it("accessor/cycle 在成为 owned key 前失败关闭", () => {
    const context = createResearchRequestReplayContext();
    const accessor = {};
    Object.defineProperty(accessor, "trap", {
      enumerable: true,
      get: () => "must not execute",
    });
    expect(() => ownResearchReplayValue(context, accessor)).toThrow(
      "RESEARCH_REPLAY_CONTEXT_ONLY_ACCEPTS_DATA_PROPERTIES",
    );
    expect(isOwnedResearchReplayValue(context, accessor)).toBe(false);

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => ownResearchReplayValue(context, cyclic)).toThrow(
      "RESEARCH_REPLAY_CONTEXT_REJECTS_CYCLES",
    );
    expect(isOwnedResearchReplayValue(context, cyclic)).toBe(false);
  });
});
