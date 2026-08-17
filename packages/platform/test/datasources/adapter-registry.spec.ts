import {
  buildDatasourceAdapterCertification,
  DATASOURCE_ADAPTER_CERTIFICATION_CHECKS,
  type DatasourceAdapterDescriptor,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  buildBuiltinDatasourceAdapterCertifications,
  buildBuiltinDatasourceAdapterDescriptors,
  createBuiltinDatasourceAdapterRegistry,
  createDatasourceAdapterRegistry,
} from "../../src/datasources/adapter-registry.js";

const hash = (character: string) => `sha256:${character.repeat(64)}`;

async function certification(descriptor: DatasourceAdapterDescriptor) {
  return buildDatasourceAdapterCertification({
    schema_version: "datasource-adapter-certification@1.0.0",
    adapter_id: descriptor.adapter_id,
    adapter_revision: descriptor.revision,
    descriptor_hash: descriptor.descriptor_hash,
    implementation_hash: hash("1"),
    fixture_hash: hash("2"),
    checks: DATASOURCE_ADAPTER_CERTIFICATION_CHECKS.map((check_id, index) => ({
      check_id,
      status: "PASS",
      evidence_hash: hash(String(index % 10)),
    })),
    result: "READY",
    reason_codes: [],
  });
}

describe("Datasource Adapter Registry", () => {
  it("publishes only the five mandatory adapters in canonical order", async () => {
    const descriptors = await buildBuiltinDatasourceAdapterDescriptors();
    expect(descriptors.map(({ adapter_id }) => adapter_id)).toEqual([
      "clickhouse",
      "duckdb",
      "mysql",
      "postgresql",
      "sqlite",
    ]);
    expect(JSON.stringify(descriptors)).not.toContain("trino");
    expect(new Set(descriptors.map(({ descriptor_hash }) => descriptor_hash)).size).toBe(5);
  });

  it("becomes platform-ready only with five exact READY certifications", async () => {
    const descriptors = await buildBuiltinDatasourceAdapterDescriptors();
    const blocked = await createDatasourceAdapterRegistry({ descriptors }).snapshot();
    expect(blocked.platform_ready).toBe(false);
    expect(
      blocked.items.every(({ effective_capability }) => effective_capability === "BLOCKED"),
    ).toBe(true);

    const ready = await createDatasourceAdapterRegistry({
      descriptors,
      certifications: await Promise.all(descriptors.map(certification)),
    }).snapshot();
    expect(ready.platform_ready).toBe(true);
    expect(
      ready.items.every(({ effective_capability }) => effective_capability === "GOVERNED_QUERY"),
    ).toBe(true);
  });

  it("ships five content-addressed deployment certification reports", async () => {
    const descriptors = await buildBuiltinDatasourceAdapterDescriptors();
    const reports = await buildBuiltinDatasourceAdapterCertifications(descriptors);
    expect(reports).toHaveLength(5);
    expect(new Set(reports.map(({ certification_hash }) => certification_hash)).size).toBe(5);
    await expect(
      (await createBuiltinDatasourceAdapterRegistry()).snapshot(),
    ).resolves.toMatchObject({
      platform_ready: true,
    });
    await expect(
      (await createBuiltinDatasourceAdapterRegistry([])).snapshot(),
    ).resolves.toMatchObject({
      platform_ready: false,
    });
  });

  it("rejects a stale certification instead of falling back to declared capability", async () => {
    const descriptors = await buildBuiltinDatasourceAdapterDescriptors();
    const descriptor = descriptors.at(0);
    if (!descriptor) throw new Error("missing Adapter descriptor fixture");
    const report = await certification(descriptor);
    await expect(
      createDatasourceAdapterRegistry({
        descriptors,
        certifications: [{ ...report, descriptor_hash: hash("f") }],
      }).snapshot(),
    ).rejects.toThrow();
  });
});
