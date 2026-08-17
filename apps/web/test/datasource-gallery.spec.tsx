import {
  buildDatasourceAdapterCertification,
  DATASOURCE_ADAPTER_CERTIFICATION_CHECKS,
} from "@data-agent/contracts";
import {
  buildBuiltinDatasourceAdapterDescriptors,
  createDatasourceAdapterRegistry,
} from "@data-agent/platform";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DatasourceGallery } from "@/components/settings/datasource-gallery";

const hash = (character: string) => `sha256:${character.repeat(64)}`;

describe("Datasource Gallery", () => {
  it("renders the exact five certified adapters and three capability levels", async () => {
    const descriptors = await buildBuiltinDatasourceAdapterDescriptors();
    const certifications = await Promise.all(
      descriptors.map((descriptor) =>
        buildDatasourceAdapterCertification({
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
        }),
      ),
    );
    const snapshot = await createDatasourceAdapterRegistry({
      descriptors,
      certifications,
    }).snapshot();
    const html = renderToStaticMarkup(<DatasourceGallery snapshot={snapshot} />);
    for (const label of ["PostgreSQL", "MySQL", "SQLite", "DuckDB", "ClickHouse"]) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain("Trino");
    expect(html.match(/>连接</g)).toHaveLength(5);
    expect(html.match(/>Schema</g)).toHaveLength(5);
    expect(html.match(/>查询</g)).toHaveLength(5);
    expect(html).toContain("5 / 5 已认证");
  });
});
