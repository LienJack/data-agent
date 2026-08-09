import "server-only";

import { randomUUID } from "node:crypto";
import type {
  PhysicalSchemaSnapshot,
  PortResult,
  SchemaDriftEvent,
  SchemaScanCommitResult,
  SchemaScanRequest,
} from "@data-agent/contracts";
import { schemaScanErrorCodeSchema } from "@data-agent/contracts";
import {
  comparePhysicalSchemaSnapshots,
  createPostgresCatalogScanner,
  type PostgresCatalogConnector,
  type PostgresSchemaSnapshotStore,
} from "@data-agent/platform";
import type { SchemaDiscoveryAuthorityContext } from "./schema-discovery-authority";

export interface ResolvedSchemaDiscoveryDatasource {
  readonly datasource_fingerprint: `sha256:${string}`;
  readonly connector: PostgresCatalogConnector;
}

/**
 * Server integration seam: an implementation must load datasource metadata,
 * resolve its DataSourceCredentialRef, authorize egress and return a short-lived
 * connector. Request JSON is never allowed to supply credentials or a DSN.
 */
export interface SchemaDiscoveryDatasourceResolver {
  resolve(
    datasourceId: string,
    authority: SchemaDiscoveryAuthorityContext,
  ): Promise<ResolvedSchemaDiscoveryDatasource>;
}

export interface SchemaScanStartResult {
  readonly scan: SchemaScanCommitResult;
  readonly snapshot: PhysicalSchemaSnapshot | null;
  readonly drift: SchemaDriftEvent | null;
}

export interface SchemaDiscoveryService {
  startScan(
    authority: SchemaDiscoveryAuthorityContext,
    request: SchemaScanRequest,
    signal?: AbortSignal,
  ): Promise<PortResult<SchemaScanStartResult>>;
  getScan(
    authority: SchemaDiscoveryAuthorityContext,
    datasourceId: string,
    scanRunId: string,
  ): ReturnType<PostgresSchemaSnapshotStore["getScan"]>;
  getSnapshot(
    authority: SchemaDiscoveryAuthorityContext,
    snapshotId: string,
  ): ReturnType<PostgresSchemaSnapshotStore["getSnapshot"]>;
  compareSnapshots(
    authority: SchemaDiscoveryAuthorityContext,
    baseSnapshotId: string,
    currentSnapshotId: string,
  ): Promise<PortResult<SchemaDriftEvent>>;
}

function unavailable(): PortResult<never> {
  return {
    ok: false,
    error: {
      code: "SCHEMA_SCAN_DATASOURCE_UNAVAILABLE",
      message: "Datasource metadata、SecretRef 或受控连接器尚未配置。",
      retryable: true,
    },
  };
}

function invalidCatalog(message: string): PortResult<never> {
  return {
    ok: false,
    error: {
      code: "SCHEMA_SCAN_CATALOG_CONTRACT_INVALID",
      message,
      retryable: false,
    },
  };
}

export function unavailableSchemaDiscoveryDatasourceResolver(): SchemaDiscoveryDatasourceResolver {
  return {
    async resolve() {
      throw new Error("schema discovery datasource resolver unavailable");
    },
  };
}

export function createSchemaDiscoveryService(
  options: Readonly<{
    store: PostgresSchemaSnapshotStore;
    datasourceResolver: SchemaDiscoveryDatasourceResolver;
    now?: () => Date;
    randomId?: () => string;
  }>,
): SchemaDiscoveryService {
  const now = options.now ?? (() => new Date());
  const randomId = options.randomId ?? randomUUID;
  const service: SchemaDiscoveryService = {
    async startScan(authority, request, signal) {
      let datasource: ResolvedSchemaDiscoveryDatasource;
      try {
        datasource = await options.datasourceResolver.resolve(request.datasource_id, authority);
      } catch {
        return unavailable();
      }
      const scanRunId = randomId();
      const snapshotId = randomId();
      const capturedAt = now().toISOString();
      const scanned = await createPostgresCatalogScanner(datasource.connector).scan(
        {
          request,
          datasource_fingerprint: datasource.datasource_fingerprint,
          snapshot_id: snapshotId,
          scan_run_id: scanRunId,
          captured_at: capturedAt,
        },
        signal,
      );
      if (!scanned.ok) {
        const errorCode = schemaScanErrorCodeSchema.safeParse(scanned.error.code);
        if (!errorCode.success) return unavailable();
        const committed = await options.store.commitFailure(authority.capabilityInput, request, {
          datasource_fingerprint: datasource.datasource_fingerprint,
          scan_run_id: scanRunId,
          captured_at: capturedAt,
          error_code: errorCode.data,
        });
        if (!committed.ok) return committed;
        return { ok: true, value: { scan: committed.value, snapshot: null, drift: null } };
      }

      const committed = await options.store.commitSuccess(
        authority.capabilityInput,
        request,
        scanned.value,
      );
      if (!committed.ok) return committed;
      const committedSnapshotId = committed.value.snapshot_id;
      const committedSnapshotHash = committed.value.snapshot_content_hash;
      if (!committedSnapshotId || !committedSnapshotHash) {
        return invalidCatalog("成功的 scan receipt 缺少物理快照 identity。");
      }
      let currentSnapshot = scanned.value;
      if (committed.value.created) {
        if (
          committedSnapshotId !== scanned.value.snapshot_id ||
          committedSnapshotHash !== scanned.value.snapshot_content_hash
        ) {
          return invalidCatalog("新建 scan receipt 与扫描得到的物理快照 identity 不一致。");
        }
      } else {
        const replayed = await options.store.getSnapshot(
          authority.capabilityInput,
          committedSnapshotId,
        );
        if (!replayed.ok) return replayed;
        if (replayed.value.snapshot_content_hash !== committedSnapshotHash) {
          return invalidCatalog("重放 scan receipt 与 PostgreSQL 权威快照 identity 不一致。");
        }
        currentSnapshot = replayed.value;
      }
      let drift: SchemaDriftEvent | null = null;
      if (request.base_snapshot_id) {
        const base = await options.store.getSnapshot(
          authority.capabilityInput,
          request.base_snapshot_id,
        );
        if (!base.ok) return base;
        drift = comparePhysicalSchemaSnapshots(base.value, currentSnapshot, {
          drift_event_id: randomId(),
          observed_at: capturedAt,
        });
        if (committed.value.created) {
          const committedDrift = await options.store.commitDrift(authority.capabilityInput, drift);
          if (!committedDrift.ok) return committedDrift;
        }
      }
      return {
        ok: true,
        value: { scan: committed.value, snapshot: currentSnapshot, drift },
      };
    },

    getScan(authority, datasourceId, scanRunId) {
      return options.store.getScan(authority.capabilityInput, datasourceId, scanRunId);
    },

    getSnapshot(authority, snapshotId) {
      return options.store.getSnapshot(authority.capabilityInput, snapshotId);
    },

    async compareSnapshots(authority, baseSnapshotId, currentSnapshotId) {
      const [base, current] = await Promise.all([
        options.store.getSnapshot(authority.capabilityInput, baseSnapshotId),
        options.store.getSnapshot(authority.capabilityInput, currentSnapshotId),
      ]);
      if (!base.ok) return base;
      if (!current.ok) return current;
      try {
        return {
          ok: true,
          value: comparePhysicalSchemaSnapshots(base.value, current.value, {
            drift_event_id: randomId(),
            observed_at: now().toISOString(),
          }),
        };
      } catch {
        return {
          ok: false,
          error: {
            code: "SCHEMA_SCAN_CATALOG_CONTRACT_INVALID",
            message: "只能比较同一 datasource fingerprint 的物理快照。",
            retryable: false,
          },
        };
      }
    },
  };
  return Object.freeze(service);
}
