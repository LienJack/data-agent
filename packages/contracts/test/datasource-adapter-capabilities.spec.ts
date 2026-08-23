import { describe, expect, it } from "vitest";
import {
  buildDatasourceAdapterCertification,
  buildDatasourceAdapterDescriptor,
  buildGovernedDatasourceQueryRequest,
  buildGovernedDatasourceQueryResult,
  buildGovernedDatasourceSchemaScanRequest,
  buildGovernedDatasourceSchemaScanResult,
  canonicalizeJson,
  DATASOURCE_ADAPTER_CERTIFICATION_CHECKS,
  datasourceAdapterRegistryItemSchema,
  verifyDatasourceAdapterCertification,
  verifyDatasourceAdapterDescriptor,
  verifyGovernedDatasourceQueryRequest,
} from "../src/index.js";

const hash = (character: string) => `sha256:${character.repeat(64)}`;

async function descriptor() {
  return buildDatasourceAdapterDescriptor({
    schema_version: "datasource-adapter-descriptor@1.0.0",
    adapter_id: "postgresql",
    revision: 1,
    display_name: "PostgreSQL",
    category: "RELATIONAL",
    dialect: "POSTGRESQL",
    topology: "WORKER_NETWORK",
    supported_capabilities: ["CONNECTION", "SCHEMA_SCAN", "GOVERNED_QUERY"],
    fields: [
      {
        field_id: "host",
        kind: "TEXT",
        label_key: "datasource.field.host",
        required: true,
        default_value: null,
        options: [],
        placeholder: "db.example.com",
      },
    ],
    driver: { package_name: "pg", version: "8.22.0", license: "MIT" },
    parser: { package_name: "pgsql-parser", version: "18.1.1", license: "MIT" },
    documentation_url: "https://www.postgresql.org/docs/current/",
  });
}

describe("Datasource Adapter capability contracts", () => {
  it("content-addresses descriptors and rejects a Driver substitution", async () => {
    const value = await descriptor();
    await expect(verifyDatasourceAdapterDescriptor(value)).resolves.toEqual(value);
    await expect(
      verifyDatasourceAdapterDescriptor({
        ...value,
        driver: { ...value.driver, version: "8.21.0" },
      }),
    ).rejects.toThrow("DATASOURCE_ADAPTER_DESCRIPTOR_HASH_MISMATCH");
  });

  it("requires every certification check before GOVERNED_QUERY", async () => {
    const value = await descriptor();
    const report = await buildDatasourceAdapterCertification({
      schema_version: "datasource-adapter-certification@1.0.0",
      adapter_id: value.adapter_id,
      adapter_revision: value.revision,
      descriptor_hash: value.descriptor_hash,
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
    await expect(verifyDatasourceAdapterCertification(report)).resolves.toEqual(report);
    expect(
      datasourceAdapterRegistryItemSchema.parse({
        descriptor: value,
        certification: report,
        effective_capability: "GOVERNED_QUERY",
      }).effective_capability,
    ).toBe("GOVERNED_QUERY");
    expect(() =>
      datasourceAdapterRegistryItemSchema.parse({
        descriptor: value,
        certification: null,
        effective_capability: "GOVERNED_QUERY",
      }),
    ).toThrow();
  });

  it("rejects incomplete or reordered capabilities and certification checks", async () => {
    await expect(
      buildDatasourceAdapterDescriptor({
        ...(await descriptor()),
        descriptor_hash: undefined,
        supported_capabilities: ["CONNECTION", "GOVERNED_QUERY", "SCHEMA_SCAN"],
      }),
    ).rejects.toThrow();
    const value = await descriptor();
    await expect(
      buildDatasourceAdapterCertification({
        schema_version: "datasource-adapter-certification@1.0.0",
        adapter_id: value.adapter_id,
        adapter_revision: value.revision,
        descriptor_hash: value.descriptor_hash,
        implementation_hash: hash("1"),
        fixture_hash: hash("2"),
        checks: DATASOURCE_ADAPTER_CERTIFICATION_CHECKS.toReversed().map((check_id) => ({
          check_id,
          status: "PASS",
          evidence_hash: hash("3"),
        })),
        result: "READY",
        reason_codes: [],
      }),
    ).rejects.toThrow();
  });

  it("binds governed query and schema scan to an exact Adapter revision", async () => {
    const value = await descriptor();
    const adapter_ref = {
      adapter_id: value.adapter_id,
      adapter_revision: value.revision,
      descriptor_hash: value.descriptor_hash,
      dialect: value.dialect,
    } as const;
    const request = await buildGovernedDatasourceQueryRequest({
      schema_version: "governed-datasource-query@1.0.0",
      scope: {
        app_id: "00000000-0000-4000-8000-000000000001",
        tenant_id: "00000000-0000-4000-8000-000000000002",
        environment: "test",
      },
      query_id: "00000000-0000-4000-8000-000000000003",
      datasource_id: "00000000-0000-4000-8000-000000000004",
      adapter_ref,
      target_capability_hash: hash("9"),
      statement: "SELECT id FROM orders",
      parameters: [],
      allowed_relations: ["orders"],
      limits: { timeout_ms: 1_000, max_rows: 10, max_bytes: 10_000 },
    });
    await expect(verifyGovernedDatasourceQueryRequest(request)).resolves.toEqual(request);
    const resultMaterial = {
      columns: [{ name: "id", type: "integer" }],
      rows: [{ id: 1 }],
    };
    const byte_count = new TextEncoder().encode(canonicalizeJson(resultMaterial)).byteLength;
    await expect(
      buildGovernedDatasourceQueryResult({
        schema_version: "governed-datasource-query-result@1.0.0",
        query_id: request.query_id,
        request_hash: request.request_hash,
        adapter_ref,
        ...resultMaterial,
        row_count: 1,
        byte_count,
        elapsed_ms: 1,
        truncated: false,
      }),
    ).resolves.toMatchObject({ row_count: 1 });

    const scan = await buildGovernedDatasourceSchemaScanRequest({
      schema_version: "governed-datasource-schema-scan@1.0.0",
      scope: request.scope,
      scan_id: "00000000-0000-4000-8000-000000000005",
      datasource_id: request.datasource_id,
      adapter_ref,
      target_capability_hash: request.target_capability_hash,
      timeout_ms: 1_000,
      max_objects: 10,
    });
    await expect(
      buildGovernedDatasourceSchemaScanResult({
        schema_version: "governed-datasource-schema-scan-result@1.0.0",
        scan_id: scan.scan_id,
        request_hash: scan.request_hash,
        adapter_ref,
        objects: [
          {
            namespace: "main",
            name: "orders",
            kind: "TABLE",
            columns: [{ name: "id", type: "integer", nullable: false }],
          },
        ],
      }),
    ).resolves.toMatchObject({ objects: [{ name: "orders" }] });
    const { request_hash: _requestHash, ...requestDraft } = request;
    await expect(
      buildGovernedDatasourceQueryRequest({
        ...requestDraft,
        adapter_ref: { ...adapter_ref, dialect: "MYSQL" },
      }),
    ).rejects.toThrow();
  });
});
