import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  capabilityEvidenceKindSchema,
  PLATFORM_CAPABILITY_IDS,
  PLATFORM_CAPABILITY_MANIFEST,
  PLATFORM_UNIT_DEPENDENCY_DAG,
  platformCapabilityManifestSchema,
} from "../src/capabilities/platform-capabilities.js";
import { sha256ContentHash } from "../src/common/index.js";

describe("platform capability manifest", () => {
  it("contains the frozen 58 capability IDs exactly once", () => {
    const parsed = platformCapabilityManifestSchema.parse(PLATFORM_CAPABILITY_MANIFEST);
    expect(parsed).toHaveLength(58);
    expect(new Set(parsed.map((entry) => entry.capability_id))).toEqual(
      new Set(PLATFORM_CAPABILITY_IDS),
    );
  });

  it("rejects missing, duplicate, unknown, duplicate-dependency and cyclic manifests", () => {
    const manifest = structuredClone(PLATFORM_CAPABILITY_MANIFEST);
    expect(() => platformCapabilityManifestSchema.parse(manifest.slice(1))).toThrow();
    expect(() => platformCapabilityManifestSchema.parse([...manifest, manifest[0]])).toThrow();
    expect(() =>
      platformCapabilityManifestSchema.parse([
        ...manifest.slice(0, -1),
        { ...manifest.at(-1), capability_id: "X99" },
      ]),
    ).toThrow();
    expect(() =>
      platformCapabilityManifestSchema.parse([
        { ...manifest[0], depends_on: ["M02", "M02"] },
        ...manifest.slice(1),
      ]),
    ).toThrow();
    expect(() =>
      platformCapabilityManifestSchema.parse([
        { ...manifest[0], depends_on: ["M02"] },
        { ...manifest[1], depends_on: ["M01"] },
        ...manifest.slice(2),
      ]),
    ).toThrow();
    expect(() =>
      platformCapabilityManifestSchema.parse(
        manifest.map((entry) =>
          entry.capability_id === "M04" ? { ...entry, depends_on: ["M03"] } : entry,
        ),
      ),
    ).toThrow(/DAG|逆向/);
  });

  it("binds every public manifest parse to the complete frozen definition snapshot", () => {
    const manifest = structuredClone(PLATFORM_CAPABILITY_MANIFEST);
    for (const mutation of [
      { ...manifest[0], status: "DELIVERED" },
      { ...manifest[0], owner: "WORKER" },
      { ...manifest[0], authority: "SIGNED_MANIFEST" },
      { ...manifest[0], evidence_kinds: ["ARTIFACT_PROOF"] },
    ]) {
      expect(() =>
        platformCapabilityManifestSchema.parse([mutation, ...manifest.slice(1)]),
      ).toThrow();
    }
  });

  it("keeps every technical evidence kind in use and binds M02 to invocation plus usage receipt", () => {
    const usedEvidenceKinds = new Set(
      PLATFORM_CAPABILITY_MANIFEST.flatMap((descriptor) => descriptor.evidence_kinds),
    );
    expect(usedEvidenceKinds).toEqual(new Set(capabilityEvidenceKindSchema.options));
    expect(
      PLATFORM_CAPABILITY_MANIFEST.find((entry) => entry.capability_id === "M02")?.evidence_kinds,
    ).toEqual(["PROVIDER_INVOCATION", "USAGE_RECEIPT"]);
    for (const forbidden of ["BILLING", "PRICE", "CREDIT", "COST", "SETTLEMENT"]) {
      expect(() => capabilityEvidenceKindSchema.parse(forbidden)).toThrow();
    }
  });

  it("freezes the independent U-ID DAG and dependency/evidence projection digest", async () => {
    expect(PLATFORM_UNIT_DEPENDENCY_DAG).toHaveLength(64);
    await expect(sha256ContentHash(PLATFORM_UNIT_DEPENDENCY_DAG)).resolves.toBe(
      "sha256:02cc2101924b0b0cbc90a3aca98bdb177a643b1d5bd104b59aeb29cc5d7a1fae",
    );
    await expect(sha256ContentHash(PLATFORM_CAPABILITY_MANIFEST)).resolves.toBe(
      "sha256:32ad31ffbcd54fbd903aea70b9bd027785faffc73ea6a6a0ef42ede7b5e135ad",
    );
  });

  it("keeps the architecture ledger mechanically aligned with U-ID and evidence kind", async () => {
    const ledger = await readFile(
      new URL("../../../docs/architecture/datafoundry-coa-capability-ledger.md", import.meta.url),
      "utf8",
    );
    const rows = [...ledger.matchAll(/^\| ([MSART]\d{2}) \| (U\d{1,2}) \| ([A-Z_,]+) \|$/gm)];
    expect(rows).toHaveLength(58);
    const ledgerEntries = new Map(rows.map((row) => [row[1], `${row[2]}:${row[3]}`]));
    for (const descriptor of PLATFORM_CAPABILITY_MANIFEST) {
      expect(ledgerEntries.get(descriptor.capability_id)).toBe(
        `${descriptor.primary_unit}:${descriptor.evidence_kinds.join(",")}`,
      );
    }
  });
});
