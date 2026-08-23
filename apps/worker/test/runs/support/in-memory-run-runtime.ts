import {
  type AppScope,
  computeMastraSnapshotBindingHash,
  hashRunProjection,
  type MastraSnapshotBinding,
  type MastraSnapshotBindingBody,
  type PortResult,
  type RunEventStorePort,
  type RunProjection,
  type RunProjectionRecord,
  type RunQueuePort,
  type RunRuntimeEvent,
  type RunWorkLease,
  reduceRunProjection,
  type SideEffectReceipt,
  type WorkerRunRuntimeEvent,
} from "@data-agent/contracts";

type Operation =
  | `event:${RunRuntimeEvent["event_type"]}`
  | "queue:complete"
  | "queue:heartbeat"
  | "queue:lease"
  | "queue:retry"
  | "side-effect:commit"
  | "snapshot:commit";

function success<T>(value: T): PortResult<T> {
  return { ok: true, value };
}

function failure<T>(code: string, retryable = false): PortResult<T> {
  return {
    ok: false,
    error: {
      code,
      message: "确定性测试夹具失败。",
      retryable,
    },
  };
}

function sameScope(left: AppScope, right: AppScope): boolean {
  return (
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment
  );
}

export class InMemoryRunRuntime implements RunQueuePort, RunEventStorePort {
  readonly operations: Operation[] = [];
  readonly completed: Array<{
    lease: RunWorkLease;
    final_event_sequence: number;
  }> = [];
  readonly heartbeats: RunWorkLease[] = [];
  readonly retried: Array<{
    lease: RunWorkLease;
    final_event_sequence: number;
    error_code: string;
    retry_delay_ms: number;
  }> = [];

  private readonly events: RunRuntimeEvent[] = [];
  private readonly projections = new Map<string, RunProjectionRecord>();
  private readonly snapshots = new Map<string, MastraSnapshotBinding>();
  private readonly sideEffects = new Map<string, SideEffectReceipt>();
  private readonly leases: RunWorkLease[] = [];
  private readonly appendFailures = new Map<RunRuntimeEvent["event_type"], string>();
  private readonly beforeAppendMutations = new Map<
    RunRuntimeEvent["event_type"],
    () => Promise<void>
  >();
  private sideEffectCommitFailure: string | null = null;

  enqueueLease(lease: RunWorkLease): void {
    this.leases.push(lease);
  }

  failNextAppend(eventType: RunRuntimeEvent["event_type"], code: string): void {
    this.appendFailures.set(eventType, code);
  }

  beforeNextAppend(eventType: RunRuntimeEvent["event_type"], mutation: () => Promise<void>): void {
    this.beforeAppendMutations.set(eventType, mutation);
  }

  failNextSideEffectCommit(code: string): void {
    this.sideEffectCommitFailure = code;
  }

  async seed(event: RunRuntimeEvent): Promise<void> {
    const projection = reduceRunProjection(null, event);
    const record = {
      projection,
      projection_hash: await hashRunProjection(projection),
    } satisfies RunProjectionRecord;
    this.events.push(event);
    this.projections.set(event.run_id, record);
    this.operations.length = 0;
  }

  async forceAppend(event: RunRuntimeEvent): Promise<void> {
    const current = await this.readProjection({
      scope: event.scope,
      run_id: event.run_id,
    });
    if (!current.ok || !current.value) {
      throw new Error("FIXTURE_PROJECTION_MISSING");
    }
    const projection = reduceRunProjection(current.value.projection, event);
    const record = {
      projection,
      projection_hash: await hashRunProjection(projection),
    } satisfies RunProjectionRecord;
    this.events.push(event);
    this.projections.set(event.run_id, record);
    this.operations.push(`event:${event.event_type}`);
  }

  eventsFor(runId: string): readonly RunRuntimeEvent[] {
    return this.events.filter((event) => event.run_id === runId);
  }

  snapshotsFor(runId: string): readonly MastraSnapshotBinding[] {
    return [...this.snapshots.values()].filter((snapshot) => snapshot.run_id === runId);
  }

  receiptsFor(runId: string): readonly SideEffectReceipt[] {
    return [...this.sideEffects.values()].filter((receipt) => receipt.run_id === runId);
  }

  async lease(input: {
    readonly scope: AppScope;
    readonly worker_id: string;
  }): Promise<PortResult<RunWorkLease | null>> {
    this.operations.push("queue:lease");
    const index = this.leases.findIndex(
      (lease) => sameScope(lease.scope, input.scope) && lease.worker_id === input.worker_id,
    );
    if (index < 0) {
      return success(null);
    }
    return success(this.leases.splice(index, 1)[0] ?? null);
  }

  async heartbeat(input: {
    readonly lease: RunWorkLease;
  }): Promise<PortResult<{ readonly expires_at: string }>> {
    this.operations.push("queue:heartbeat");
    this.heartbeats.push(input.lease);
    return success({ expires_at: input.lease.expires_at });
  }

  async complete(input: {
    readonly lease: RunWorkLease;
    readonly final_event_sequence: number;
  }): Promise<PortResult<{ readonly acknowledged: true }>> {
    this.operations.push("queue:complete");
    this.completed.push(input);
    return success({ acknowledged: true });
  }

  async retry(input: {
    readonly lease: RunWorkLease;
    readonly final_event_sequence: number;
    readonly error_code: string;
    readonly retry_delay_ms: number;
  }): Promise<PortResult<{ readonly released: true }>> {
    this.operations.push("queue:retry");
    this.retried.push(input);
    return success({ released: true });
  }

  async readProjection(input: {
    readonly scope: AppScope;
    readonly run_id: string;
  }): Promise<PortResult<RunProjectionRecord | null>> {
    const record = this.projections.get(input.run_id);
    if (!record || !sameScope(record.projection.scope, input.scope)) {
      return success(null);
    }
    return success(record);
  }

  async append(input: {
    readonly lease: RunWorkLease;
    readonly event: WorkerRunRuntimeEvent;
    readonly expected_projection: RunProjectionRecord;
  }): Promise<
    PortResult<{
      readonly replayed: boolean;
      readonly event: RunRuntimeEvent;
      readonly projection: RunProjection;
      readonly projection_hash: string;
    }>
  > {
    const mutation = this.beforeAppendMutations.get(input.event.event_type);
    if (mutation) {
      this.beforeAppendMutations.delete(input.event.event_type);
      await mutation();
    }
    const failureCode = this.appendFailures.get(input.event.event_type);
    if (failureCode) {
      this.appendFailures.delete(input.event.event_type);
      return failure(failureCode, true);
    }

    const replayed = this.events.find(
      (event) =>
        sameScope(event.scope, input.event.scope) &&
        event.run_id === input.event.run_id &&
        event.idempotency_key === input.event.idempotency_key,
    );
    if (replayed) {
      const record = this.projections.get(input.event.run_id);
      if (!record) {
        return failure("FIXTURE_PROJECTION_MISSING");
      }
      return success({
        replayed: true,
        event: replayed,
        projection: record.projection,
        projection_hash: record.projection_hash,
      });
    }

    const current = this.projections.get(input.event.run_id) ?? null;
    if (current?.projection_hash !== input.expected_projection.projection_hash) {
      return failure("RUN_PROJECTION_CONFLICT", true);
    }
    const projection = reduceRunProjection(input.expected_projection.projection, input.event);
    const projectionHash = await hashRunProjection(projection);
    const record = {
      projection,
      projection_hash: projectionHash,
    } satisfies RunProjectionRecord;
    this.events.push(input.event);
    this.projections.set(input.event.run_id, record);
    this.operations.push(`event:${input.event.event_type}`);
    return success({
      replayed: false,
      event: input.event,
      projection,
      projection_hash: projectionHash,
    });
  }

  async listEvents(input: {
    readonly scope: AppScope;
    readonly run_id: string;
    readonly after_sequence?: number;
    readonly limit?: number;
  }): Promise<PortResult<readonly RunRuntimeEvent[]>> {
    return success(
      this.events
        .filter(
          (event) =>
            event.run_id === input.run_id &&
            sameScope(event.scope, input.scope) &&
            event.sequence > (input.after_sequence ?? 0),
        )
        .slice(0, input.limit ?? 256),
    );
  }

  async findEventByIdempotencyKey(input: {
    readonly scope: AppScope;
    readonly run_id: string;
    readonly idempotency_key: string;
  }): Promise<PortResult<RunRuntimeEvent | null>> {
    const event = this.events.find(
      (candidate) =>
        candidate.run_id === input.run_id &&
        sameScope(candidate.scope, input.scope) &&
        candidate.idempotency_key === input.idempotency_key,
    );
    return success(event ?? null);
  }

  async commitSnapshot(input: { readonly binding: MastraSnapshotBindingBody }): Promise<
    PortResult<{
      readonly created: boolean;
      readonly binding: MastraSnapshotBinding;
    }>
  > {
    this.operations.push("snapshot:commit");
    const binding = {
      ...input.binding,
      snapshot_hash: await computeMastraSnapshotBindingHash(input.binding),
    };
    const created = !this.snapshots.has(binding.snapshot_hash);
    this.snapshots.set(binding.snapshot_hash, binding);
    return success({ created, binding });
  }

  async loadLatestSnapshot(input: {
    readonly scope: AppScope;
    readonly run_id: string;
  }): Promise<PortResult<MastraSnapshotBinding | null>> {
    const snapshots = [...this.snapshots.values()]
      .filter(
        (snapshot) => snapshot.run_id === input.run_id && sameScope(snapshot.scope, input.scope),
      )
      .sort((left, right) => right.snapshot_version - left.snapshot_version);
    return success(snapshots[0] ?? null);
  }

  async findSideEffect(input: {
    readonly scope: AppScope;
    readonly run_id: string;
    readonly effect_kind: SideEffectReceipt["effect_kind"];
    readonly input_hash: string;
  }): Promise<PortResult<SideEffectReceipt | null>> {
    const receipt = [...this.sideEffects.values()].find(
      (candidate) =>
        candidate.run_id === input.run_id &&
        sameScope(candidate.scope, input.scope) &&
        candidate.effect_kind === input.effect_kind &&
        candidate.input_hash === input.input_hash,
    );
    return success(receipt ?? null);
  }

  async commitSideEffect(input: {
    readonly receipt: SideEffectReceipt;
  }): Promise<PortResult<{ readonly created: boolean; readonly receipt: SideEffectReceipt }>> {
    this.operations.push("side-effect:commit");
    if (this.sideEffectCommitFailure) {
      const code = this.sideEffectCommitFailure;
      this.sideEffectCommitFailure = null;
      return failure(code, true);
    }
    const key = [
      input.receipt.scope.environment,
      input.receipt.scope.app_id,
      input.receipt.scope.tenant_id,
      input.receipt.run_id,
      input.receipt.effect_kind,
      input.receipt.input_hash,
    ].join("\u0000");
    const existing = this.sideEffects.get(key);
    if (existing) {
      return success({ created: false, receipt: existing });
    }
    this.sideEffects.set(key, input.receipt);
    return success({ created: true, receipt: input.receipt });
  }
}
