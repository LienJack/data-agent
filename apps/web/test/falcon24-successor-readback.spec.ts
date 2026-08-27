import type {
  Falcon24SemanticAuthorityClosure,
  SemanticSuccessorStageEnvelope,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createFalcon24SuccessorFinalizationReadback } from "../src/lib/falcon24-successor-readback";

const id = (suffix: number) => `90000000-0000-5000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

const release = {
  release_id: id(1),
  generation: 2,
  release_digest: hash("a"),
  datasource_id: id(2),
} as const;
const closure: Falcon24SemanticAuthorityClosure = {
  schema_version: "falcon24-semantic-authority-closure@1.0.0",
  scope: {
    app_id: id(3),
    tenant_id: id(4),
    environment: "test",
    semantic_domain: "falcon24",
  },
  authority: {
    schema_version: "falcon24-authority-binding@2.0.0",
    authority_epoch: "E4",
    baseline_id: id(5),
    baseline_hash: hash("b"),
    activation_attempt_id: id(6),
  },
  semantic_pointer: { version: 2, release },
  semantic_runtime: { version: 2, release },
  workspace_defaults: { version: 2, release },
};
const promoted = { stage: { status: "PROMOTED" } } as unknown as SemanticSuccessorStageEnvelope;

describe("Falcon24 successor production readback", () => {
  it("binds both production readers to one capability and semantic domain", async () => {
    const capability = { authority: "owner" };
    const loadClosure = vi.fn(async () => ({ ok: true as const, value: closure }));
    const loadPromotedRelease = vi.fn(async () => ({ ok: true as const, value: promoted }));
    const readback = createFalcon24SuccessorFinalizationReadback({
      capability,
      semantic_domain: "falcon24",
      closure_reader: { load: loadClosure },
      successor_reader: { loadPromotedRelease },
    });

    await expect(readback.loadCurrentClosure()).resolves.toEqual(closure);
    await expect(
      readback.loadPublishedRelease({
        semantic_domain: "falcon24",
        release_id: release.release_id,
      }),
    ).resolves.toEqual(promoted);
    expect(loadClosure).toHaveBeenCalledWith(capability, { semantic_domain: "falcon24" });
    expect(loadPromotedRelease).toHaveBeenCalledWith(capability, {
      semantic_domain: "falcon24",
      release_id: release.release_id,
    });
  });

  it("rejects a cross-domain release read before calling PostgreSQL", async () => {
    const loadPromotedRelease = vi.fn();
    const readback = createFalcon24SuccessorFinalizationReadback({
      capability: { authority: "owner" },
      semantic_domain: "falcon24",
      closure_reader: { load: vi.fn() },
      successor_reader: { loadPromotedRelease },
    });

    await expect(
      readback.loadPublishedRelease({ semantic_domain: "other", release_id: release.release_id }),
    ).rejects.toThrow("FALCON24_SEMANTIC_SUCCESSOR_READBACK_SCOPE_MISMATCH");
    expect(loadPromotedRelease).not.toHaveBeenCalled();
  });

  it("preserves stable port failures", async () => {
    const readback = createFalcon24SuccessorFinalizationReadback({
      capability: { authority: "owner" },
      semantic_domain: "falcon24",
      closure_reader: {
        load: vi.fn(async () => ({
          ok: false as const,
          error: {
            code: "FALCON24_SEMANTIC_AUTHORITY_CLOSURE_INVALID",
            message: "mixed closure",
            retryable: false,
          },
        })),
      },
      successor_reader: { loadPromotedRelease: vi.fn() },
    });

    await expect(readback.loadCurrentClosure()).rejects.toThrow(
      "FALCON24_SEMANTIC_AUTHORITY_CLOSURE_INVALID",
    );
  });
});
