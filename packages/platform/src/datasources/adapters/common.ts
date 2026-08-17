import {
  buildGovernedDatasourceQueryResult,
  buildGovernedDatasourceSchemaScanResult,
  canonicalizeJson,
  type DatasourceAdapterDescriptor,
  type GovernedDatasourceQueryRequest,
  type GovernedDatasourceQueryResult,
  type GovernedDatasourceSchemaScanRequest,
  type GovernedDatasourceSchemaScanResult,
  type PortResult,
  verifyDatasourceAdapterDescriptor,
  verifyGovernedDatasourceQueryRequest,
  verifyGovernedDatasourceSchemaScanRequest,
} from "@data-agent/contracts";
import { z } from "zod";

const transportResultSchema = z.strictObject({
  columns: z
    .array(z.strictObject({ name: z.string().min(1).max(128), type: z.string().max(128) }))
    .max(512),
  rows: z.array(z.record(z.string(), z.json())).max(100_001),
});
const transportSchemaResultSchema = z.array(
  z.strictObject({
    namespace: z.string().min(1).max(128),
    name: z.string().min(1).max(128),
    kind: z.enum(["TABLE", "VIEW"]),
    columns: z.array(
      z.strictObject({
        name: z.string().min(1).max(128),
        type: z.string().min(1).max(256),
        nullable: z.boolean(),
      }),
    ),
  }),
);

export interface DatasourceAdapterTargetAuthority {
  authorize(request: GovernedDatasourceQueryRequest | GovernedDatasourceSchemaScanRequest): Promise<
    PortResult<{
      readonly target_capability_hash: string;
      readonly target: unknown;
    }>
  >;
}

export interface DatasourceAdapterTransport {
  scanSchema(input: {
    readonly request: GovernedDatasourceSchemaScanRequest;
    readonly target: unknown;
    readonly signal: AbortSignal;
  }): Promise<unknown>;
  explain(input: {
    readonly request: GovernedDatasourceQueryRequest;
    readonly target: unknown;
    readonly signal: AbortSignal;
  }): Promise<void>;
  execute(input: {
    readonly request: GovernedDatasourceQueryRequest;
    readonly target: unknown;
    readonly signal: AbortSignal;
  }): Promise<unknown>;
}

export interface GovernedDatasourceAdapter {
  readonly descriptor: DatasourceAdapterDescriptor;
  scanSchema(
    input: unknown,
    signal?: AbortSignal,
  ): Promise<PortResult<GovernedDatasourceSchemaScanResult>>;
  execute(input: unknown, signal?: AbortSignal): Promise<PortResult<GovernedDatasourceQueryResult>>;
}

export class DatasourceAdapterPolicyError extends Error {
  override readonly name = "DatasourceAdapterPolicyError";

  constructor(readonly code: string) {
    super(code);
  }
}

const failure = (code: string, message: string, retryable = false): PortResult<never> => ({
  ok: false,
  error: { code, message, retryable },
});

async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  inputSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  inputSignal?.addEventListener("abort", abort, { once: true });
  if (inputSignal?.aborted) controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_TIMEOUT")),
          { once: true },
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    inputSignal?.removeEventListener("abort", abort);
  }
}

export async function createGovernedDatasourceAdapter(input: {
  readonly descriptor: DatasourceAdapterDescriptor;
  readonly target_authority: DatasourceAdapterTargetAuthority;
  readonly validate_statement: (request: GovernedDatasourceQueryRequest) => void | Promise<void>;
  readonly transport: DatasourceAdapterTransport;
  readonly now?: () => number;
}): Promise<GovernedDatasourceAdapter> {
  const descriptor = await verifyDatasourceAdapterDescriptor(input.descriptor);
  const now = input.now ?? Date.now;
  return Object.freeze({
    descriptor,
    async scanSchema(
      requestInput: unknown,
      signal?: AbortSignal,
    ): Promise<PortResult<GovernedDatasourceSchemaScanResult>> {
      let request: GovernedDatasourceSchemaScanRequest;
      try {
        request = await verifyGovernedDatasourceSchemaScanRequest(requestInput);
      } catch {
        return failure(
          "DATASOURCE_ADAPTER_SCAN_REQUEST_INVALID",
          "Adapter scan request is invalid.",
        );
      }
      if (
        request.adapter_ref.adapter_id !== descriptor.adapter_id ||
        request.adapter_ref.adapter_revision !== descriptor.revision ||
        request.adapter_ref.descriptor_hash !== descriptor.descriptor_hash ||
        request.adapter_ref.dialect !== descriptor.dialect
      ) {
        return failure(
          "DATASOURCE_ADAPTER_BINDING_MISMATCH",
          "Adapter revision or dialect is stale.",
        );
      }
      const target = await input.target_authority.authorize(request);
      if (!target.ok) return target;
      if (target.value.target_capability_hash !== request.target_capability_hash) {
        return failure(
          "DATASOURCE_ADAPTER_TARGET_MISMATCH",
          "Target capability does not match request.",
        );
      }
      try {
        const raw = await withTimeout(
          (executionSignal) =>
            input.transport.scanSchema({
              request,
              target: target.value.target,
              signal: executionSignal,
            }),
          signal,
          request.timeout_ms,
        );
        const objects = transportSchemaResultSchema
          .parse(raw)
          .toSorted(
            (left, right) =>
              left.namespace.localeCompare(right.namespace) || left.name.localeCompare(right.name),
          );
        if (objects.length > request.max_objects) {
          return failure(
            "DATASOURCE_ADAPTER_SCHEMA_LIMIT_EXCEEDED",
            "Schema object limit exceeded.",
          );
        }
        return {
          ok: true,
          value: await buildGovernedDatasourceSchemaScanResult({
            schema_version: "governed-datasource-schema-scan-result@1.0.0",
            scan_id: request.scan_id,
            request_hash: request.request_hash,
            adapter_ref: request.adapter_ref,
            objects,
          }),
        };
      } catch (error) {
        return failure(
          error instanceof DatasourceAdapterPolicyError
            ? error.code
            : "DATASOURCE_ADAPTER_SCHEMA_SCAN_FAILED",
          "Datasource schema scan failed without releasing an unverified result.",
          error instanceof DatasourceAdapterPolicyError &&
            error.code === "DATASOURCE_ADAPTER_TIMEOUT",
        );
      }
    },
    async execute(
      requestInput: unknown,
      signal?: AbortSignal,
    ): Promise<PortResult<GovernedDatasourceQueryResult>> {
      let request: GovernedDatasourceQueryRequest;
      try {
        request = await verifyGovernedDatasourceQueryRequest(requestInput);
      } catch {
        return failure("DATASOURCE_ADAPTER_REQUEST_INVALID", "Adapter query request is invalid.");
      }
      if (
        request.adapter_ref.adapter_id !== descriptor.adapter_id ||
        request.adapter_ref.adapter_revision !== descriptor.revision ||
        request.adapter_ref.descriptor_hash !== descriptor.descriptor_hash ||
        request.adapter_ref.dialect !== descriptor.dialect
      ) {
        return failure(
          "DATASOURCE_ADAPTER_BINDING_MISMATCH",
          "Adapter revision or dialect is stale.",
        );
      }
      const target = await input.target_authority.authorize(request);
      if (!target.ok) return target;
      if (target.value.target_capability_hash !== request.target_capability_hash) {
        return failure(
          "DATASOURCE_ADAPTER_TARGET_MISMATCH",
          "Target capability does not match request.",
        );
      }
      try {
        await input.validate_statement(request);
      } catch (error) {
        return failure(
          error instanceof DatasourceAdapterPolicyError
            ? error.code
            : "DATASOURCE_ADAPTER_SQL_REJECTED",
          "Datasource statement was rejected before I/O.",
        );
      }
      const startedAt = now();
      try {
        const raw = await withTimeout(
          async (executionSignal) => {
            await input.transport.explain({
              request,
              target: target.value.target,
              signal: executionSignal,
            });
            return input.transport.execute({
              request,
              target: target.value.target,
              signal: executionSignal,
            });
          },
          signal,
          request.limits.timeout_ms,
        );
        const result = transportResultSchema.parse(raw);
        const bytes = new TextEncoder().encode(
          canonicalizeJson({ columns: result.columns, rows: result.rows }),
        ).byteLength;
        if (result.rows.length > request.limits.max_rows) {
          return failure("DATASOURCE_ADAPTER_ROW_LIMIT_EXCEEDED", "Datasource row limit exceeded.");
        }
        if (bytes > request.limits.max_bytes) {
          return failure(
            "DATASOURCE_ADAPTER_BYTE_LIMIT_EXCEEDED",
            "Datasource byte limit exceeded.",
          );
        }
        return {
          ok: true,
          value: await buildGovernedDatasourceQueryResult({
            schema_version: "governed-datasource-query-result@1.0.0",
            query_id: request.query_id,
            request_hash: request.request_hash,
            adapter_ref: request.adapter_ref,
            columns: result.columns,
            rows: result.rows,
            row_count: result.rows.length,
            byte_count: bytes,
            elapsed_ms: Math.max(0, now() - startedAt),
            truncated: false,
          }),
        };
      } catch (error) {
        return failure(
          error instanceof DatasourceAdapterPolicyError
            ? error.code
            : "DATASOURCE_ADAPTER_EXECUTION_FAILED",
          "Datasource execution failed without releasing an unverified result.",
          error instanceof DatasourceAdapterPolicyError &&
            error.code === "DATASOURCE_ADAPTER_TIMEOUT",
        );
      }
    },
  });
}
