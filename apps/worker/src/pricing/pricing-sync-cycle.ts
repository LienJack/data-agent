import { randomUUID } from "node:crypto";
import type {
  createPostgresPricingControlRepository,
  PricingAdminContext,
  PricingSyncFailure,
} from "@data-agent/platform";
import {
  MAX_PRICING_EVIDENCE_BYTES,
  type OfficialPricingSourceAdapter,
} from "./official-source-adapters.js";

export interface PricingEvidenceFetcher {
  fetch(input: {
    readonly url: string;
    readonly timeout_ms: number;
    readonly max_bytes: number;
  }): Promise<string>;
}

type PricingRepository = ReturnType<typeof createPostgresPricingControlRepository>;

export interface PricingSyncCycleResult {
  readonly adapter: string;
  readonly status: "SUCCEEDED" | "FAILED";
  readonly error_code: string | null;
}

function publicErrorCode(error: unknown): string {
  if (error instanceof SyntaxError) return "PRICING_SOURCE_JSON_INVALID";
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,127}$/.test(error.message)) {
    return error.message;
  }
  return "PRICING_SOURCE_SYNC_FAILED";
}

function boundedEvidence(value: string): string {
  if (Buffer.byteLength(value, "utf8") <= MAX_PRICING_EVIDENCE_BYTES) return value;
  return "";
}

export function createPricingSyncCycle(dependencies: {
  readonly repository: PricingRepository;
  readonly context: PricingAdminContext;
  readonly fetcher: PricingEvidenceFetcher;
  readonly sources: readonly OfficialPricingSourceAdapter[];
  readonly now?: () => Date;
  readonly operation_id?: () => string;
  readonly timeout_ms?: number;
}) {
  const now = dependencies.now ?? (() => new Date());
  const operationId = dependencies.operation_id ?? randomUUID;
  const timeoutMs = dependencies.timeout_ms ?? 15_000;

  return Object.freeze({
    async runOnce(): Promise<readonly PricingSyncCycleResult[]> {
      const results: PricingSyncCycleResult[] = [];
      for (const source of dependencies.sources) {
        const operation_id = operationId();
        const fetched_at = now().toISOString();
        let rawEvidence = "";
        try {
          rawEvidence = await dependencies.fetcher.fetch({
            url: source.source_url,
            timeout_ms: timeoutMs,
            max_bytes: MAX_PRICING_EVIDENCE_BYTES,
          });
          if (Buffer.byteLength(rawEvidence, "utf8") > MAX_PRICING_EVIDENCE_BYTES) {
            throw new Error("PRICING_SOURCE_EVIDENCE_TOO_LARGE");
          }
          const persisted =
            source.kind === "MODEL_PRICE"
              ? await dependencies.repository.submitPriceSync(
                  dependencies.context,
                  source.parse({ operation_id, fetched_at, raw_evidence: rawEvidence }),
                )
              : await dependencies.repository.submitFxSync(
                  dependencies.context,
                  source.parse({ operation_id, fetched_at, raw_evidence: rawEvidence }),
                );
          if (!persisted.ok) throw new Error(persisted.error.code);
          results.push({ adapter: source.adapter_version, status: "SUCCEEDED", error_code: null });
        } catch (error) {
          const errorCode = publicErrorCode(error);
          const failure: PricingSyncFailure = {
            operation_id,
            source_kind: source.kind,
            source_adapter: source.adapter_version,
            source_url: source.source_url,
            parser_version: source.adapter_version,
            fetched_at,
            raw_evidence: boundedEvidence(rawEvidence),
            error_code: errorCode,
          };
          await dependencies.repository.recordSyncFailure(dependencies.context, failure);
          results.push({
            adapter: source.adapter_version,
            status: "FAILED",
            error_code: errorCode,
          });
        }
      }
      return Object.freeze(results);
    },
  });
}

export function createPricingSyncScheduler(dependencies: {
  readonly cycle: { runOnce(): Promise<readonly PricingSyncCycleResult[]> };
  readonly interval_ms: number;
  readonly on_cycle?: (results: readonly PricingSyncCycleResult[]) => void;
  readonly on_error?: (error: unknown) => void;
}) {
  if (!Number.isSafeInteger(dependencies.interval_ms) || dependencies.interval_ms < 1_000) {
    throw new Error("PRICING_SYNC_INTERVAL_INVALID");
  }
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const results = await dependencies.cycle.runOnce();
      dependencies.on_cycle?.(results);
    } catch (error) {
      dependencies.on_error?.(error);
    } finally {
      running = false;
    }
  };

  return Object.freeze({
    start() {
      if (timer) return;
      void tick();
      timer = setInterval(() => void tick(), dependencies.interval_ms);
      timer.unref();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
    isRunning() {
      return timer !== null;
    },
  });
}
