import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { falcon24StableTargetWaitScript } from "../src/cli/falcon24-four-layer-browser-gate";

type Frame = {
  y: number;
  covered?: boolean;
  missing?: boolean;
  disabled?: boolean;
  width?: number;
  replacement?: boolean;
};

async function observe(frames: Frame[], requireHitTarget: boolean) {
  let now = 0;
  let samples = 0;
  const fallback: Frame = { y: 100 };
  const current = () => frames[Math.min(samples, frames.length - 1)] ?? fallback;
  const target = {
    get disabled() {
      return current().disabled ?? false;
    },
    getBoundingClientRect: () => ({
      x: 40,
      y: current().y,
      width: current().width ?? 100,
      height: 30,
    }),
    contains: (hit: unknown) => hit === target,
  };
  const replacement = { ...target, contains: (hit: unknown) => hit === replacement };
  const element = () => (current().replacement ? replacement : target);
  const result = await new Script(
    falcon24StableTargetWaitScript("#target", requireHitTarget),
  ).runInNewContext({
    performance: { now: () => now },
    innerWidth: 1440,
    innerHeight: 900,
    document: {
      querySelector: () => (current().missing ? null : element()),
      elementFromPoint: () => (current().covered ? {} : element()),
    },
    requestAnimationFrame: (callback: () => void) =>
      queueMicrotask(() => {
        now += 16;
        samples += 1;
        callback();
      }),
  });
  return { result, now, samples };
}

describe("Falcon browser target stability", () => {
  it("does not accept the first actionable frame during smooth return scrolling", async () => {
    const result = await observe(
      [{ y: 508 }, { y: 512 }, { y: 538 }, { y: 615 }, { y: 645, covered: true }],
      false,
    );
    expect(result.result).toBe(true);
    expect(result.now).toBeGreaterThanOrEqual(184);
  });

  it("requires a fresh stable interval after layout changes or target replacement", async () => {
    const result = await observe(
      [...Array<Frame>(7).fill({ y: 100 }), { y: 100, replacement: true }],
      true,
    );
    expect(result.result).toBe(true);
    expect(result.now).toBeGreaterThanOrEqual(232);
  });

  it("accepts a stable visible target only after the observation interval", async () => {
    const result = await observe([{ y: 100 }], true);
    expect(result.result).toBe(true);
    expect(result.now).toBeGreaterThanOrEqual(120);
  });

  it("restarts the hit-target interval when an overlay leaves", async () => {
    const result = await observe(
      [...Array<Frame>(7).fill({ y: 100, covered: true }), { y: 100 }],
      true,
    );
    expect(result.result).toBe(true);
    expect(result.now).toBeGreaterThanOrEqual(216);
  });

  it("bounds observation of a target that never stops moving", async () => {
    const result = await observe(
      Array.from({ length: 1600 }, (_, index) => ({ y: 100 + (index % 2) })),
      true,
    );
    expect(result.result).toBe(false);
    expect(result.samples).toBeLessThan(1600);
  });

  it.each([
    { y: 100, covered: true },
    { y: 100, missing: true },
    { y: 100, disabled: true },
    { y: 100, width: 0 },
    { y: 1000 },
  ])("fails closed for a persistently non-actionable target: %j", async (frame) => {
    const result = await observe([frame], true);
    expect(result.result).toBe(false);
    expect(result.now).toBeGreaterThanOrEqual(25000);
    expect(result.samples).toBeLessThan(1600);
  });
});
