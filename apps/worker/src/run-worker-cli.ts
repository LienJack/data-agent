import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import {
  effectiveConfigRunLeasePayloadSchema,
  type PortResult,
  type RunQueuePort,
  type RunWorkLease,
} from "@data-agent/contracts";
import {
  adaptPgPool,
  createClamAvInstreamClient,
  createFileScanPort,
  createFileSystemStorageClient,
  createNeo4jKnowledgeIndexFromEnvironment,
  createOpenAiCompatibleEmbeddingProviderFactory,
  createPostgresAgentProfileRegistry,
  createPostgresArtifactWorkspaceStore,
  createPostgresCapabilityAuthority,
  createPostgresEcommerceBenchmarkExecutor,
  createPostgresEffectiveConfigResolver,
  createPostgresJobQueue,
  createPostgresKnowledgeRegistry,
  createPostgresOperationsAdminRepository,
  createPostgresProductTeamArtifactStore,
  createPostgresProviderInvocationSmokeJob,
  createPostgresRepository,
  createPostgresResearchAuthority,
  createPostgresResolvedContextRegistry,
  createPostgresRunEventStore,
  createPostgresRunQueue,
  createPostgresSemanticInductionRegistry,
  createPostgresTeamRunStore,
  createPostgresWorkspaceFiles,
  createUnavailableKnowledgeIndex,
  createWorkspaceContentNamespace,
  type KnowledgeIndex,
  providerInvocationSmokeClaimSchema,
} from "@data-agent/platform";
import { createResolvedContextService } from "@data-agent/semantic";
import pg from "pg";
import { z } from "zod";
import { createArtifactExportJobHandler } from "./jobs/artifact-export-job-handler.js";
import { createFileScanJobHandler } from "./jobs/file-scan-job-handler.js";
import { runJobWorkerLoop } from "./jobs/job-worker-daemon.js";
import { createJobWorkerRunner } from "./jobs/job-worker-runner.js";
import { createSemanticInductionJobHandler } from "./jobs/semantic-induction-job-handler.js";
import { createKnowledgeIndexJobHandler } from "./knowledge/knowledge-index-job.js";
import { createProductionRunBoundProviderDispatcher } from "./providers/production-run-bound-provider-dispatcher.js";
import { createProviderSmokeExecutor } from "./providers/provider-smoke-executor.js";
import { loadRunWorkerEnvironment } from "./run-worker-environment.js";
import {
  createMultiPrincipalRunWorkerRunner,
  isRunnableWorkspaceMember,
} from "./runs/multi-principal-runner.js";
import { createResearchWorkflowExecutor } from "./runs/research-workflow-executor.js";
import { createRunBoundResolvedContextResolver } from "./runs/run-bound-resolved-context.js";
import {
  createInitialWorkerHealth,
  parseRunWorkerEnvironment,
  runWorkerLoop,
  type WorkerCycleLogRecord,
  type WorkerHealthState,
} from "./runs/run-worker-daemon.js";
import { createRunWorkerRunner } from "./runs/run-worker-runner.js";
import { createDataAgentTeamRunner } from "./teams/data-agent-team-runner.js";
import { createDirectAnswerExecutor } from "./teams/direct-answer-executor.js";
import { createProductionTeamRuntime } from "./teams/production-team-runtime.js";
import { createProductionTeamTools } from "./teams/production-team-tools.js";
import { createRunWorkflowExecutorRouter } from "./teams/run-workflow-executor-router.js";

class RunWorkerStartupError extends Error {
  override readonly name = "RunWorkerStartupError";

  constructor(readonly code: string) {
    super(code);
  }
}

export function requireCompletedProviderSmokeCycle(result: {
  readonly ok: boolean;
  readonly value?: { readonly kind?: string };
  readonly error?: { readonly code?: string };
}): void {
  if (result.ok !== true || result.value?.kind !== "COMPLETED") {
    throw new RunWorkerStartupError("PROVIDER_INVOCATION_SMOKE_NOT_COMPLETED");
  }
}

export function targetProviderSmokeQueue(
  queue: RunQueuePort,
  claimTarget: (
    input: Parameters<RunQueuePort["lease"]>[0],
  ) => Promise<PortResult<{ readonly lease: RunWorkLease } | null>>,
): RunQueuePort {
  let attempted = false;
  return Object.freeze({
    ...queue,
    async lease(input: Parameters<RunQueuePort["lease"]>[0]): ReturnType<RunQueuePort["lease"]> {
      if (attempted) return { ok: true, value: null };
      attempted = true;
      const claimed = await claimTarget(input);
      return claimed.ok
        ? { ok: true, value: claimed.value?.lease ?? null }
        : { ok: false, error: claimed.error };
    },
  });
}

function writeLog(record: WorkerCycleLogRecord): void {
  const { level, ...fields } = record;
  const output = JSON.stringify(fields);
  switch (level) {
    case "info":
      console.info(output);
      return;
    case "warn":
      console.warn(output);
      return;
    case "error":
      console.error(output);
      return;
  }
}

function createHealthServer(health: WorkerHealthState): Server {
  return createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/live") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(health.initialized ? 200 : 503, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    response.end(
      JSON.stringify({
        status: health.initialized ? "ready" : "starting",
        ...health,
      }),
    );
  });
}

async function listen(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "0.0.0.0");
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function runWorkerProcess(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (
    environment.DATA_AGENT_U3_PROVIDER_SMOKE_ONE_SHOT === "YES" &&
    environment.DATA_AGENT_U3_PROVIDER_SMOKE_CONFIRM !== "YES"
  ) {
    throw new RunWorkerStartupError("EXPLICIT_CONFIRMATION_REQUIRED");
  }
  environment = loadRunWorkerEnvironment(environment);
  const config = parseRunWorkerEnvironment(environment);
  const smokeTarget =
    environment.DATA_AGENT_U3_PROVIDER_SMOKE_ONE_SHOT === "YES"
      ? z.strictObject({ run_id: z.uuid(), command_id: z.uuid() }).parse({
          run_id: environment.DATA_AGENT_U3_PROVIDER_SMOKE_RUN_ID,
          command_id: environment.DATA_AGENT_U3_PROVIDER_SMOKE_COMMAND_ID,
        })
      : null;
  const pool = new pg.Pool({
    connectionString: config.database_url,
    connectionTimeoutMillis: 5_000,
    query_timeout: 15_000,
    statement_timeout: 12_000,
    idle_in_transaction_session_timeout: 15_000,
  });
  const smokeJobPool = smokeTarget
    ? new pg.Pool({
        connectionString: z.string().min(1).parse(environment.DATA_AGENT_JOB_DATABASE_URL),
        connectionTimeoutMillis: 5_000,
        query_timeout: 15_000,
        statement_timeout: 12_000,
        idle_in_transaction_session_timeout: 15_000,
      })
    : null;
  const sqlPool = adaptPgPool(pool);
  let smokeJob: ReturnType<typeof createPostgresProviderInvocationSmokeJob> | null = null;
  const smokeClaimState: {
    value: z.infer<typeof providerInvocationSmokeClaimSchema> | null;
  } = { value: null };
  const capabilityAuthority = createPostgresCapabilityAuthority(sqlPool);
  const fileStorage = createFileSystemStorageClient(
    environment.DATA_AGENT_WORKSPACE_FILE_STORAGE_ROOT ?? ".data/workspace-content",
  );
  const fileScanPolicyVersion = "workspace-file-policy@1.0.0";
  const fileScanner = createFileScanPort({
    clamav: createClamAvInstreamClient({
      host: environment.DATA_AGENT_CLAMAV_HOST ?? "127.0.0.1",
      port: z.coerce
        .number()
        .int()
        .min(1)
        .max(65_535)
        .parse(environment.DATA_AGENT_CLAMAV_PORT ?? 3310),
      timeout_ms: z.coerce
        .number()
        .int()
        .min(100)
        .max(120_000)
        .parse(environment.DATA_AGENT_CLAMAV_TIMEOUT_MS ?? 30_000),
      max_bytes: 25 * 1024 * 1024,
    }),
    now: () => new Date(),
    max_signature_age_ms: 7 * 24 * 60 * 60 * 1_000,
    policy_version: fileScanPolicyVersion,
  });
  let knowledgeIndex: KnowledgeIndex = createUnavailableKnowledgeIndex();
  try {
    const configuredIndex = createNeo4jKnowledgeIndexFromEnvironment(environment);
    try {
      await configuredIndex.initialize();
      knowledgeIndex = configuredIndex;
    } catch {
      await configuredIndex.close();
    }
  } catch {
    // Missing Neo4j configuration keeps the handler fail-closed without
    // preventing unrelated Run and Job capabilities from starting.
  }
  const embeddingProviderFactory = createOpenAiCompatibleEmbeddingProviderFactory(environment);
  const controller = new AbortController();
  const health = createInitialWorkerHealth(config.research_authority_capability_id !== null);
  const healthServer = createHealthServer(health);
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    const resolved = await capabilityAuthority.resolveForServerContext({
      deployment_id: config.deployment_id,
      tenant_id: config.tenant_id,
      principal_id: config.principal_id,
      access: "WRITE",
    });
    if (!resolved.ok) throw new RunWorkerStartupError(resolved.error.code);

    const appCapability = resolved.value;
    if (smokeJobPool) {
      smokeJob = createPostgresProviderInvocationSmokeJob({
        pool: adaptPgPool(smokeJobPool),
        authorizer: capabilityAuthority.authorizer,
        capability: appCapability,
      });
    }
    const operations = createPostgresOperationsAdminRepository(sqlPool);
    const researchAuthority = createPostgresResearchAuthority({
      pool: sqlPool,
      authorizer: capabilityAuthority.authorizer,
    });
    const effectiveConfigResolver = createPostgresEffectiveConfigResolver({
      pool: sqlPool,
      authorizer: capabilityAuthority.authorizer,
    });
    const runner = createMultiPrincipalRunWorkerRunner({
      listPrincipals: async () => {
        if (smokeTarget) {
          return { ok: true, value: [{ principal_id: config.principal_id }] };
        }
        const members = await operations.listWorkspaceMembers({
          deployment_id: config.deployment_id,
          principal_id: config.principal_id,
          workspace_id: config.tenant_id,
        });
        if (!members.ok) return members;
        return {
          ok: true,
          value: members.value
            .filter(isRunnableWorkspaceMember)
            .map((member) => ({ principal_id: member.principal_id })),
        };
      },
      createRunner: async (principalId) => {
        const principalCapability = await capabilityAuthority.resolveForServerContext({
          deployment_id: config.deployment_id,
          tenant_id: config.tenant_id,
          principal_id: principalId,
          access: "WRITE",
        });
        if (!principalCapability.ok) return principalCapability;
        const capability = principalCapability.value;
        const providerDispatch = createProductionRunBoundProviderDispatcher({
          pool: sqlPool,
          authorizer: capabilityAuthority.authorizer,
          capability,
          environment,
        });
        const resolvedContext = createRunBoundResolvedContextResolver({
          capability,
          service: createResolvedContextService({
            authority: createPostgresResolvedContextRegistry({
              pool: sqlPool,
              authorizer: capabilityAuthority.authorizer,
            }),
          }),
        });
        const researchExecutor = createResearchWorkflowExecutor({
          research_authority: researchAuthority,
          authority_capability_input: config.research_authority_capability_id
            ? {
                app_capability: capability,
                authority_capability_id: config.research_authority_capability_id,
              }
            : null,
          principal_id: principalId,
          create_id: randomUUID,
          now: () => new Date(),
        });
        const profileRegistry = createPostgresAgentProfileRegistry({
          pool: sqlPool,
          authorizer: capabilityAuthority.authorizer,
        });
        const teamStore = createPostgresTeamRunStore({
          pool: sqlPool,
          authorizer: capabilityAuthority.authorizer,
        });
        const teamArtifacts = createPostgresProductTeamArtifactStore({
          pool: sqlPool,
          authorizer: capabilityAuthority.authorizer,
        });
        const ecommerceSandbox = createPostgresEcommerceBenchmarkExecutor({ pool });
        const teamExecutor = createDataAgentTeamRunner({
          profiles: {
            listEnabled: (profileCapability) => profileRegistry.list(profileCapability, true),
          },
          profile_capability_input: capability,
          direct: createDirectAnswerExecutor(),
          runtime: createProductionTeamRuntime({
            store: teamStore,
            capability,
            artifacts: {
              verifyCommitted: (reference) => teamArtifacts.verifyCommitted(capability, reference),
              resolveCommitted: (reference) =>
                teamArtifacts.resolveCommitted(capability, reference),
            },
            create_tools: (input) =>
              createProductionTeamTools(
                {
                  capability,
                  artifacts: teamArtifacts,
                  sandbox: ecommerceSandbox,
                },
                input,
              ),
          }),
        });
        const executor = smokeTarget
          ? createProviderSmokeExecutor()
          : createRunWorkflowExecutorRouter({ research: researchExecutor, team: teamExecutor });
        const queue = createPostgresRunQueue(sqlPool, capabilityAuthority.authorizer, capability, {
          lease_duration_ms: config.lease_duration_ms,
        });
        const eventStore = createPostgresRunEventStore(
          sqlPool,
          capabilityAuthority.authorizer,
          capability,
        );
        return {
          ok: true,
          value: createRunWorkerRunner({
            queue: smokeTarget
              ? targetProviderSmokeQueue(queue, async ({ worker_id: workerId }) => {
                  if (!smokeJob) {
                    throw new RunWorkerStartupError("PROVIDER_INVOCATION_SMOKE_JOB_REQUIRED");
                  }
                  const claimed = await smokeJob.claim({
                    worker_id: workerId,
                    lease_duration_ms: config.lease_duration_ms,
                    expected_run_id: smokeTarget.run_id,
                    expected_command_id: smokeTarget.command_id,
                  });
                  if (claimed.ok) smokeClaimState.value = claimed.value;
                  return claimed;
                })
              : queue,
            event_store: eventStore,
            executor,
            provider_dispatch: providerDispatch,
            resolved_context: resolvedContext,
            effective_config_loader: (lease) => {
              const payload = effectiveConfigRunLeasePayloadSchema.safeParse(lease.payload);
              if (!payload.success || lease.command_kind !== payload.data.kind) {
                return Promise.resolve({
                  ok: false,
                  error: {
                    code: "EFFECTIVE_CONFIG_WORKER_CONSUMPTION_INVALID",
                    message: "Worker Lease 必须只携带 Effective Config Reference。",
                    retryable: false,
                  },
                });
              }
              return effectiveConfigResolver.revalidateForWorker({
                principal_capability: capability,
                context_receipt_id: lease.attempt_id,
                lease: {
                  ...lease,
                  command_kind: payload.data.kind,
                  payload: payload.data,
                },
              });
            },
            execution_timeout_ms: config.execution_timeout_ms,
            heartbeat_interval_ms: config.heartbeat_interval_ms,
            side_effect_timeout_ms: config.side_effect_timeout_ms,
          }),
        };
      },
    });

    let jobPrincipalCursor = 0;
    const jobRunner = {
      async runOnce(input: {
        scope: typeof appCapability.scope;
        worker_id: string;
        signal: AbortSignal;
      }) {
        const members = await operations.listWorkspaceMembers({
          deployment_id: config.deployment_id,
          principal_id: config.principal_id,
          workspace_id: config.tenant_id,
        });
        if (!members.ok) return members;
        const principals = members.value
          .filter(isRunnableWorkspaceMember)
          .map((member) => member.principal_id);
        if (principals.length === 0) return { ok: true as const, value: { kind: "IDLE" as const } };
        for (let offset = 0; offset < principals.length; offset += 1) {
          const index = (jobPrincipalCursor + offset) % principals.length;
          const principalId = principals[index];
          if (!principalId) continue;
          const principalCapability = await capabilityAuthority.resolveForServerContext({
            deployment_id: config.deployment_id,
            tenant_id: config.tenant_id,
            principal_id: principalId,
            access: "WRITE",
          });
          if (!principalCapability.ok) continue;
          const capability = principalCapability.value;
          const queue = createPostgresJobQueue(
            sqlPool,
            capabilityAuthority.authorizer,
            capability,
            { lease_duration_ms: config.lease_duration_ms },
          );
          const exportStore = createPostgresArtifactWorkspaceStore({
            pool: sqlPool,
            authorizer: capabilityAuthority.authorizer,
          });
          const workspaceFiles = createPostgresWorkspaceFiles({
            pool: sqlPool,
            authorizer: capabilityAuthority.authorizer,
          });
          const knowledgeRegistry = createPostgresKnowledgeRegistry({
            pool: sqlPool,
            authorizer: capabilityAuthority.authorizer,
          });
          const semanticInductionRegistry = createPostgresSemanticInductionRegistry({
            pool: sqlPool,
            authorizer: capabilityAuthority.authorizer,
          });
          const workspaceContent = createWorkspaceContentNamespace(
            fileStorage,
            capabilityAuthority.authorizer,
          );
          const principalRunner = createJobWorkerRunner({
            queue,
            lease_duration_ms: config.lease_duration_ms,
            handlers: [
              createArtifactExportJobHandler({
                capability,
                workspace: {
                  repository: createPostgresRepository(sqlPool, capabilityAuthority.authorizer),
                  exportStore,
                },
              }),
              createFileScanJobHandler({
                capability,
                files: workspaceFiles,
                content: workspaceContent,
                scanner: fileScanner,
                policy_version: fileScanPolicyVersion,
              }),
              createKnowledgeIndexJobHandler({
                capability,
                registry: knowledgeRegistry,
                content: workspaceContent,
                embedding: embeddingProviderFactory,
                index: knowledgeIndex,
                create_id: randomUUID,
                now: () => new Date(),
              }),
              createSemanticInductionJobHandler({
                capability,
                registry: semanticInductionRegistry,
              }),
              createSemanticInductionJobHandler({
                capability,
                registry: semanticInductionRegistry,
                kind: "METRIC_IMPORT",
              }),
            ],
          });
          const cycle = await principalRunner.runOnce({
            scope: input.scope,
            worker_id: input.worker_id,
            signal: input.signal,
          });
          if (!cycle.ok || cycle.value.kind !== "IDLE") {
            jobPrincipalCursor = (index + 1) % principals.length;
            return cycle;
          }
        }
        jobPrincipalCursor = (jobPrincipalCursor + 1) % principals.length;
        return { ok: true as const, value: { kind: "IDLE" as const } };
      },
    };

    if (environment.DATA_AGENT_U3_PROVIDER_SMOKE_ONE_SHOT === "YES") {
      const result = await runner.runOnce({
        scope: appCapability.scope,
        worker_id: config.worker_id,
      });
      writeLog(
        result.ok
          ? {
              level: "info",
              event_name: "run_worker_cycle",
              cycle_kind: result.value.kind,
              ...(result.value.kind === "IDLE"
                ? {}
                : {
                    run_id: result.value.run_id,
                    final_event_sequence:
                      "final_event_sequence" in result.value
                        ? result.value.final_event_sequence
                        : result.value.observed_event_sequence,
                  }),
            }
          : {
              level: result.error.retryable ? "warn" : "error",
              event_name: "run_worker_cycle_failed",
              reason_code: result.error.code,
              retryable: result.error.retryable,
            },
      );
      requireCompletedProviderSmokeCycle(result);
      if (!smokeJob || !smokeClaimState.value) {
        throw new RunWorkerStartupError("PROVIDER_INVOCATION_SMOKE_PRECONDITION_MISSING");
      }
      const smokeClaim = providerInvocationSmokeClaimSchema.parse(smokeClaimState.value);
      const proof = await smokeJob.verifyCompleted({
        run_id: smokeClaim.lease.run_id,
        command_id: smokeClaim.lease.command_id,
        attempt_id: smokeClaim.lease.attempt_id,
        worker_fence: smokeClaim.lease.worker_fence,
      });
      if (!proof.ok) throw new RunWorkerStartupError(proof.error.code);
      console.info(
        JSON.stringify({
          event_name: "provider_invocation_smoke_proved",
          status: proof.value.outcome_status,
          run_id: proof.value.run_id,
          command_id: proof.value.command_id,
          invocation_id: proof.value.logical_invocation_id,
          intent_id: proof.value.intent_id,
          permit_id: proof.value.permit_id,
          marker_id: proof.value.marker_id,
          outcome_id: proof.value.outcome_id,
          usage_receipt_id: proof.value.usage_receipt_id,
          response_artifact_ref: {
            artifact_id: proof.value.response_artifact_ref.artifact_id,
            content_hash: proof.value.response_artifact_ref.content_hash,
          },
        }),
      );
      return;
    }

    await listen(healthServer, config.health_port);
    writeLog({
      level: "info",
      event_name: "run_worker_started",
      reason_code: config.research_authority_capability_id
        ? "RESEARCH_AUTHORITY_CONFIGURED"
        : "RESEARCH_AUTHORITY_NOT_CONFIGURED",
    });
    await Promise.all([
      runWorkerLoop({
        runner,
        scope: appCapability.scope,
        worker_id: config.worker_id,
        poll_interval_ms: config.poll_interval_ms,
        signal: controller.signal,
        health,
        logger: writeLog,
      }),
      runJobWorkerLoop({
        runner: jobRunner,
        scope: appCapability.scope,
        worker_id: `${config.worker_id}:jobs`,
        poll_interval_ms: config.poll_interval_ms,
        signal: controller.signal,
        health,
        logger: (record) => {
          const { level, ...fields } = record;
          const output = JSON.stringify(fields);
          if (level === "error") console.error(output);
          else if (level === "warn") console.warn(output);
          else console.info(output);
        },
      }),
    ]);
  } finally {
    health.initialized = false;
    controller.abort();
    await closeServer(healthServer);
    await knowledgeIndex.close();
    await smokeJobPool?.end();
    await pool.end();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runWorkerProcess().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event_name: "run_worker_stopped",
        reason_code:
          error instanceof z.ZodError
            ? "WORKER_CONFIG_INVALID"
            : error instanceof RunWorkerStartupError
              ? error.code
              : "WORKER_STARTUP_FAILED",
      }),
    );
    process.exitCode = 1;
  });
}
