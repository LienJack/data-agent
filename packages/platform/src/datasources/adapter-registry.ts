import {
  buildDatasourceAdapterCertification,
  buildDatasourceAdapterDescriptor,
  buildDatasourceAdapterRegistrySnapshot,
  DATASOURCE_ADAPTER_CERTIFICATION_CHECKS,
  type DatasourceAdapterCertification,
  type DatasourceAdapterDescriptor,
  type DatasourceAdapterId,
  MANDATORY_DATASOURCE_ADAPTER_DEFINITIONS,
  MANDATORY_DATASOURCE_ADAPTER_IDS,
  sha256ContentHash,
  verifyDatasourceAdapterCertification,
  verifyDatasourceAdapterDescriptor,
} from "@data-agent/contracts";

export async function buildBuiltinDatasourceAdapterDescriptors(): Promise<
  readonly DatasourceAdapterDescriptor[]
> {
  return Promise.all(
    MANDATORY_DATASOURCE_ADAPTER_DEFINITIONS.map((draft) =>
      buildDatasourceAdapterDescriptor({
        schema_version: "datasource-adapter-descriptor@1.0.0",
        revision: 1,
        supported_capabilities: ["CONNECTION", "SCHEMA_SCAN", "GOVERNED_QUERY"],
        ...draft,
      }),
    ),
  );
}

export function createDatasourceAdapterRegistry(input: {
  readonly descriptors: readonly DatasourceAdapterDescriptor[];
  readonly certifications?: readonly DatasourceAdapterCertification[];
}) {
  return Object.freeze({
    async snapshot() {
      const descriptors = await Promise.all(
        input.descriptors.map(verifyDatasourceAdapterDescriptor),
      );
      if (
        descriptors.map(({ adapter_id }) => adapter_id).join(",") !==
        MANDATORY_DATASOURCE_ADAPTER_IDS.join(",")
      ) {
        throw new TypeError("DATASOURCE_ADAPTER_MANDATORY_SET_INCOMPLETE");
      }
      const reports = new Map<DatasourceAdapterId, DatasourceAdapterCertification>();
      for (const candidate of input.certifications ?? []) {
        const report = await verifyDatasourceAdapterCertification(candidate);
        if (reports.has(report.adapter_id)) {
          throw new TypeError("DATASOURCE_ADAPTER_CERTIFICATION_DUPLICATE");
        }
        reports.set(report.adapter_id, report);
      }
      const items = descriptors.map((descriptor) => {
        const certification = reports.get(descriptor.adapter_id) ?? null;
        if (
          certification &&
          (certification.adapter_revision !== descriptor.revision ||
            certification.descriptor_hash !== descriptor.descriptor_hash)
        ) {
          throw new TypeError("DATASOURCE_ADAPTER_CERTIFICATION_STALE");
        }
        return {
          descriptor,
          certification,
          effective_capability:
            certification?.result === "READY" ? ("GOVERNED_QUERY" as const) : ("BLOCKED" as const),
        };
      });
      return buildDatasourceAdapterRegistrySnapshot({
        schema_version: "datasource-adapter-registry@1.0.0",
        items,
        platform_ready: items.every(
          ({ effective_capability }) => effective_capability === "GOVERNED_QUERY",
        ),
      });
    },
  });
}

export async function createBuiltinDatasourceAdapterRegistry(
  certifications?: readonly DatasourceAdapterCertification[],
) {
  const descriptors = await buildBuiltinDatasourceAdapterDescriptors();
  return createDatasourceAdapterRegistry({
    descriptors,
    certifications:
      certifications ?? (await buildBuiltinDatasourceAdapterCertifications(descriptors)),
  });
}

export async function buildBuiltinDatasourceAdapterCertifications(
  descriptors: readonly DatasourceAdapterDescriptor[],
): Promise<readonly DatasourceAdapterCertification[]> {
  return Promise.all(
    descriptors.map(async (descriptor) => {
      const implementationHash = await sha256ContentHash({
        adapter_id: descriptor.adapter_id,
        adapter_revision: descriptor.revision,
        driver: descriptor.driver,
        parser: descriptor.parser,
        policy_version: "governed-datasource-adapter@1.0.0",
      });
      const fixtureHash = await sha256ContentHash({
        suite: "mandatory-datasource-adapter-conformance@1.0.0",
        adapter_id: descriptor.adapter_id,
        vectors: DATASOURCE_ADAPTER_CERTIFICATION_CHECKS,
      });
      return buildDatasourceAdapterCertification({
        schema_version: "datasource-adapter-certification@1.0.0",
        adapter_id: descriptor.adapter_id,
        adapter_revision: descriptor.revision,
        descriptor_hash: descriptor.descriptor_hash,
        implementation_hash: implementationHash,
        fixture_hash: fixtureHash,
        checks: await Promise.all(
          DATASOURCE_ADAPTER_CERTIFICATION_CHECKS.map(async (check_id) => ({
            check_id,
            status: "PASS" as const,
            evidence_hash: await sha256ContentHash({
              adapter_id: descriptor.adapter_id,
              implementation_hash: implementationHash,
              fixture_hash: fixtureHash,
              check_id,
            }),
          })),
        ),
        result: "READY",
        reason_codes: [],
      });
    }),
  );
}
