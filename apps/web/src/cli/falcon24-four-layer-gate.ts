import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { artifactReferenceSchema } from "@data-agent/contracts/artifacts";
import {
  type Falcon24FourLayerManifestTurn,
  verifyFalcon24FourLayerGateManifest,
} from "@data-agent/contracts/evals";
import { toPublicRunEvent } from "@data-agent/contracts/runs";
import { createPostgresRepository } from "@data-agent/platform/persistence";
import {
  createPostgresFalcon24FourLayerGateAuthority,
  createPostgresRunEventStore,
  type PostgresFalcon24FourLayerGateTurn,
} from "@data-agent/platform/runs";
import {
  loadRuntimeEnvironment,
  resolveRuntimeRepositoryRoot,
} from "@data-agent/platform/runtime-config";
import { z } from "zod";
import { getWebRuntimeBuildIdentity } from "@/lib/runtime-build-identity";
import {
  closeWorkspaceIdentityRuntime,
  getEffectiveConfigResolver,
  getResolutionTraceProjector,
  getWorkspaceAuthority,
  getWorkspaceDataRepository,
  getWorkspaceSqlPool,
} from "@/lib/workspace-identity";
import { submitFalcon24QuestionFromBrowser } from "./falcon24-browser-trace-gate";
import {
  observeFalcon24FourLayerQaUi,
  observeFalcon24FourLayerTraceUi,
  preflightFalcon24FourLayerBrowserSubmission,
  smokeFalcon24FourLayerConversationAt390,
} from "./falcon24-four-layer-browser-gate";
import { evaluateFalcon24FourLayerBusiness } from "./falcon24-four-layer-business-gate";
import {
  falcon24FourLayerBindingIdentity,
  falcon24FourLayerConversationMatchesDefaults,
} from "./falcon24-four-layer-control-identity";
import {
  createFalcon24FourLayerController,
  falcon24FourLayerBrowserSession,
} from "./falcon24-four-layer-controller";

const scopeSchema = z.strictObject({
  deploymentId: z.uuid(),
  workspaceId: z.uuid(),
  principalId: z.uuid(),
});
const runSchema = z.strictObject({
  run_id: z.uuid(),
  status: z.enum(["QUEUED", "RUNNING", "WAITING", "SUCCEEDED", "FAILED", "CANCELLED"]),
});
const terminalRunSchema = runSchema.extend({
  status: z.enum(["SUCCEEDED", "FAILED", "CANCELLED"]),
});

type PortResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string } };

function value<T>(result: PortResult<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function argument(name: string): string | undefined {
  const direct = process.argv.find((candidate) => candidate.startsWith(`--${name}=`));
  if (direct) return direct.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function report(document: unknown): void {
  process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
}

function stableErrorCode(error: unknown): string {
  const candidates = [
    typeof error === "object" && error !== null && "code" in error
      ? (error as { readonly code?: unknown }).code
      : null,
    error instanceof Error ? error.message : null,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    if (/^[A-Z][A-Z0-9_]{2,127}$/u.test(candidate)) return candidate;
    const codes = [...new Set(candidate.match(/[A-Z][A-Z0-9_]{2,127}/gu) ?? [])];
    if (codes.length === 1) return codes[0] ?? "FALCON24_FOUR_LAYER_CONTROL_FAILED";
  }
  return "FALCON24_FOUR_LAYER_CONTROL_FAILED";
}

async function readJson(root: string, path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

async function loadAllPublicEvents(input: {
  readonly store: ReturnType<typeof createPostgresRunEventStore>;
  readonly scope: {
    readonly app_id: string;
    readonly tenant_id: string;
    readonly environment: string;
  };
  readonly run_id: string;
}) {
  const events = [];
  let afterSequence = 0;
  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    const page = value(
      await input.store.listEvents({
        scope: input.scope,
        run_id: input.run_id,
        after_sequence: afterSequence,
        limit: 500,
      }),
    );
    events.push(...page);
    const nextSequence = page.at(-1)?.sequence;
    if (page.length < 500) return Object.freeze(events.map(toPublicRunEvent));
    if (!nextSequence || nextSequence <= afterSequence) {
      throw new Error("FALCON24_FOUR_LAYER_EVENT_CURSOR_INVALID");
    }
    afterSequence = nextSequence;
  }
  throw new Error("FALCON24_FOUR_LAYER_EVENT_LIMIT_EXCEEDED");
}

async function loadTurns(input: {
  readonly authority: ReturnType<typeof createPostgresFalcon24FourLayerGateAuthority>;
  readonly capability: unknown;
  readonly attempt_id: string;
}): Promise<PostgresFalcon24FourLayerGateTurn[]> {
  return Promise.all(
    Array.from({ length: 15 }, async (_, turnOrdinal) => {
      const turn = value(
        await input.authority.loadTurn(input.capability, {
          attempt_id: input.attempt_id,
          turn_ordinal: turnOrdinal,
        }),
      );
      if (!turn) throw new Error("FALCON24_FOUR_LAYER_NOT_FOUND");
      return turn;
    }),
  );
}

function conversationRunIds(
  turns: readonly PostgresFalcon24FourLayerGateTurn[],
  current: PostgresFalcon24FourLayerGateTurn,
) {
  return turns
    .filter(
      (candidate) =>
        candidate.turn_ordinal <= current.turn_ordinal &&
        candidate.conversation_id === current.conversation_id &&
        candidate.run_id !== null,
    )
    .map(({ run_id: runId }) => z.uuid().parse(runId));
}

async function loadTraceClosure(input: {
  readonly capability: unknown;
  readonly scope: {
    readonly app_id: string;
    readonly tenant_id: string;
    readonly environment: string;
  };
  readonly run_id: string;
}) {
  const projector = getResolutionTraceProjector();
  const trace = value(
    await projector.loadTrace(input.capability, { scope: input.scope, run_id: input.run_id }),
  );
  if (!trace) throw new Error("FALCON24_RESOLUTION_TRACE_EMPTY");
  const details = await Promise.all(
    trace.nodes.map(async ({ node_id: nodeId }) => {
      const detail = value(
        await projector.loadDetail(input.capability, {
          scope: input.scope,
          run_id: input.run_id,
          node_id: nodeId,
          expected_trace_hash: trace.trace_hash,
        }),
      );
      if (!detail || detail.node_id !== nodeId) {
        throw new Error("FALCON24_RESOLUTION_TRACE_DETAIL_INVALID");
      }
      return detail;
    }),
  );
  return Object.freeze({ trace, details });
}

async function loadArtifactReferences(root: string, path: string | undefined) {
  if (!path) return [] as const;
  return z
    .array(artifactReferenceSchema)
    .max(64)
    .parse(await readJson(root, path));
}

function assertWebBuildIdentity(manifest: {
  readonly web_build_hash: string;
  readonly web_generation_hash: string;
}): void {
  const current = getWebRuntimeBuildIdentity();
  if (
    current.build_id !== manifest.web_build_hash ||
    current.generation_id !== manifest.web_generation_hash
  ) {
    throw new Error("FALCON24_FOUR_LAYER_WEB_BUILD_MISMATCH");
  }
}

async function main(): Promise<void> {
  const root = resolveRuntimeRepositoryRoot(process.cwd());
  const environment = loadRuntimeEnvironment({ cwd: root, environment: process.env }).environment;
  Object.assign(process.env, environment);
  const command = process.argv[2];
  if (!["begin", "status", "advance", "finalize", "smoke-390"].includes(command ?? "")) {
    throw new Error("FALCON24_FOUR_LAYER_COMMAND_INVALID");
  }
  const scope = scopeSchema.parse({
    deploymentId:
      argument("deployment-id") ??
      environment.WORKER_DEPLOYMENT_ID ??
      environment.SEMANTIC_DEPLOYMENT_ID,
    workspaceId:
      argument("workspace-id") ?? environment.WORKER_TENANT_ID ?? environment.SEMANTIC_TENANT_ID,
    principalId:
      argument("principal-id") ??
      environment.WORKER_PRINCIPAL_ID ??
      environment.SEMANTIC_PRINCIPAL_ID,
  });
  const attemptId = z.uuid().parse(argument("attempt-id"));
  const workspaceAuthority = getWorkspaceAuthority();
  const capability = value(
    await workspaceAuthority.resolveForServerContext({
      deployment_id: scope.deploymentId,
      workspace_id: scope.workspaceId,
      principal_id: scope.principalId,
      access: command === "status" || command === "smoke-390" ? "READ" : "WRITE",
    }),
  );
  const sqlPool = getWorkspaceSqlPool();
  const authority = createPostgresFalcon24FourLayerGateAuthority({
    pool: sqlPool,
    authorizer: workspaceAuthority.authorizer,
  });
  const runRepository = createPostgresRepository(sqlPool, workspaceAuthority.authorizer);
  const eventStore = createPostgresRunEventStore(
    sqlPool,
    workspaceAuthority.authorizer,
    capability,
  );

  if (command === "begin") {
    const manifestPath = z.string().min(1).parse(argument("manifest"));
    const manifest = await verifyFalcon24FourLayerGateManifest(await readJson(root, manifestPath));
    if (manifest.attempt_id !== attemptId) {
      throw new Error("FALCON24_FOUR_LAYER_ATTEMPT_IDENTITY_MISMATCH");
    }
    assertWebBuildIdentity(manifest);
    const attempt = value(await authority.begin(capability, manifest));
    report({ terminal: "READY", attempt });
    return;
  }

  const attempt = value(await authority.loadAttempt(capability, { attempt_id: attemptId }));
  if (!attempt) throw new Error("FALCON24_FOUR_LAYER_NOT_FOUND");
  const manifest = await verifyFalcon24FourLayerGateManifest(attempt.manifest_document);

  if (command === "status") {
    const turns = await loadTurns({ authority, capability, attempt_id: attemptId });
    const runs = await Promise.all(
      turns.map(async (turn) =>
        turn.run_id ? value(await runRepository.getRun(capability, { run_id: turn.run_id })) : null,
      ),
    );
    report({ terminal: "STATUS", attempt, turns, runs });
    return;
  }

  if (command === "finalize") {
    const finalized = value(
      await authority.finalizeAttempt(capability, {
        attempt_id: attemptId,
        expected_attempt_version: attempt.attempt_version,
      }),
    );
    report({ terminal: finalized.status, attempt: finalized });
    return;
  }

  assertWebBuildIdentity(manifest);

  if (command === "smoke-390") {
    if (attempt.status !== "PASSED") throw new Error("FALCON24_FOUR_LAYER_ATTEMPT_NOT_PASSED");
    const turns = await loadTurns({ authority, capability, attempt_id: attemptId });
    const observations = [];
    for (const ordinal of [11, 14]) {
      const turn = turns[ordinal];
      if (!turn?.run_id || !turn.conversation_id) {
        throw new Error("FALCON24_FOUR_LAYER_CONVERSATION_MISMATCH");
      }
      const { trace } = await loadTraceClosure({
        capability,
        scope: capability.scope,
        run_id: turn.run_id,
      });
      observations.push(
        await smokeFalcon24FourLayerConversationAt390({
          session: falcon24FourLayerBrowserSession({ attempt_id: attemptId, turn }),
          web_base_url: z.string().url().parse(argument("web-base-url")),
          workspace_id: scope.workspaceId,
          conversation_id: turn.conversation_id,
          binding: { run_id: turn.run_id, trace_hash: trace.trace_hash },
          viewport: { width: 390, height: 844 },
        }),
      );
    }
    report({ terminal: "SMOKE_390_PASSED", submitted: false, observations });
    return;
  }

  const turnOrdinal = z.coerce.number().int().min(0).max(14).parse(argument("turn-ordinal"));
  const frozenTurn = manifest.turns[turnOrdinal];
  if (!frozenTurn) throw new Error("FALCON24_FOUR_LAYER_TURN_NOT_FOUND");
  const identities = falcon24FourLayerBindingIdentity({
    workspace_id: scope.workspaceId,
    principal_id: scope.principalId,
    attempt_id: attemptId,
    turn: frozenTurn,
  });
  const workspaceData = getWorkspaceDataRepository();
  const defaults = value(await getEffectiveConfigResolver().getWorkspaceDefaults(capability))
    ?.revision.defaults;
  if (!defaults?.datasource || !defaults.model) {
    throw new Error("FALCON24_FOUR_LAYER_DEFAULTS_REQUIRED");
  }
  let conversation = value(
    await workspaceData.getConversation(capability, identities.conversation_id),
  );
  if (!conversation) {
    conversation = value(
      await workspaceData.createConversation(capability, {
        schema_version: "workspace-conversation-create@1.0.0",
        conversation_id: identities.conversation_id,
        title: `Falcon24 ${manifest.gate_id} ${frozenTurn.conversation_group ?? frozenTurn.turn_id}`,
        datasource_id: defaults.datasource.resource_id,
        model_id: null,
        model_profile_id: defaults.model.resource_id,
      }),
    );
  }
  if (
    !falcon24FourLayerConversationMatchesDefaults({
      conversation,
      defaults: {
        datasource_resource_id: defaults.datasource.resource_id,
        model_resource_id: defaults.model.resource_id,
      },
    })
  ) {
    throw new Error("FALCON24_FOUR_LAYER_CONVERSATION_RESOURCE_MISMATCH");
  }
  const currentTurn = value(
    await authority.loadTurn(capability, { attempt_id: attemptId, turn_ordinal: turnOrdinal }),
  );
  if (!currentTurn) throw new Error("FALCON24_FOUR_LAYER_NOT_FOUND");
  const binding = {
    conversation_id: identities.conversation_id,
    conversation_resource_version:
      currentTurn.conversation_resource_version ??
      z.number().int().positive().safe().parse(conversation.resource_version),
    run_id: identities.run_id,
    idempotency_key: identities.idempotency_key,
  } as const;
  const screenshotRoot = resolve(
    root,
    argument("screenshot-root") ?? `artifacts/falcon24-four-layer/${attemptId}`,
  );
  await mkdir(screenshotRoot, { recursive: true });
  const rubricEvidencePath =
    argument("rubric-evidence") ??
    (argument("rubric-evidence-dir")
      ? resolve(argument("rubric-evidence-dir") as string, `${frozenTurn.turn_id}.json`)
      : undefined);
  const acceptedInputPath = argument("accepted-input-artifact-refs");
  const webBaseUrl = () => z.string().url().parse(argument("web-base-url"));
  const allTurns = () => loadTurns({ authority, capability, attempt_id: attemptId });

  const controller = createFalcon24FourLayerController({
    authority,
    load_run: async (runId) => {
      const run = value(await runRepository.getRun(capability, { run_id: runId }));
      return run ? runSchema.parse({ run_id: run.run_id, status: run.status }) : null;
    },
    submit_turn: async ({ session, claim }) => {
      const turns = await allTurns();
      const claimed = turns[turnOrdinal];
      if (!claimed) throw new Error("FALCON24_FOUR_LAYER_NOT_FOUND");
      await preflightFalcon24FourLayerBrowserSubmission({
        session,
        web_base_url: webBaseUrl(),
        workspace_id: scope.workspaceId,
        claim,
        expected_web_build: {
          build_id: manifest.web_build_hash,
          generation_id: manifest.web_generation_hash,
        },
        previous_run_ids: conversationRunIds(turns, claimed).filter(
          (runId) => runId !== claim.four_layer_fence.run_id,
        ),
        viewport: { width: 1440, height: 900 },
      });
      await submitFalcon24QuestionFromBrowser({
        session,
        web_base_url: webBaseUrl(),
        workspace_id: scope.workspaceId,
        conversation_id: claim.conversation_id,
        expected_run_id: claim.four_layer_fence.run_id,
        question: claim.question,
        viewport: { width: 1440, height: 900 },
        claim,
      });
    },
    evaluate_business: async ({ turn, run }) => {
      const publicEvents = await loadAllPublicEvents({
        store: eventStore,
        scope: capability.scope,
        run_id: run.run_id,
      });
      return evaluateFalcon24FourLayerBusiness({
        manifest,
        turn,
        run: terminalRunSchema.parse(run),
        public_events: publicEvents,
        rubric_evidence: rubricEvidencePath ? await readJson(root, rubricEvidencePath) : undefined,
        accepted_input_artifact_refs: await loadArtifactReferences(root, acceptedInputPath),
      });
    },
    observe_qa: async ({ turn, business }) => {
      const turns = await allTurns();
      return observeFalcon24FourLayerQaUi({
        session: falcon24FourLayerBrowserSession({ attempt_id: attemptId, turn }),
        web_base_url: webBaseUrl(),
        screenshot_path: resolve(screenshotRoot, turn.turn_id),
        workspace_id: scope.workspaceId,
        turn: manifest.turns[turn.turn_ordinal] as Falcon24FourLayerManifestTurn,
        business,
        expected_web_build: {
          build_id: manifest.web_build_hash,
          generation_id: manifest.web_generation_hash,
        },
        conversation_run_ids: conversationRunIds(turns, turn),
        viewport: { width: 1440, height: 900 },
      });
    },
    observe_trace: async ({ turn, business, qa }) => {
      const turns = await allTurns();
      const runIds = conversationRunIds(turns, turn);
      const current = await loadTraceClosure({
        capability,
        scope: capability.scope,
        run_id: business.run_id,
      });
      const conversationTraces = await Promise.all(
        runIds.map(async (runId) => {
          const { trace } =
            runId === business.run_id
              ? current
              : await loadTraceClosure({ capability, scope: capability.scope, run_id: runId });
          return { run_id: runId, trace_hash: trace.trace_hash };
        }),
      );
      return observeFalcon24FourLayerTraceUi({
        session: falcon24FourLayerBrowserSession({ attempt_id: attemptId, turn }),
        web_base_url: webBaseUrl(),
        screenshot_path: resolve(screenshotRoot, turn.turn_id),
        workspace_id: scope.workspaceId,
        business,
        qa,
        trace: current.trace,
        details: current.details,
        expected_web_build: {
          build_id: manifest.web_build_hash,
          generation_id: manifest.web_generation_hash,
        },
        conversation_traces: conversationTraces,
        viewport: { width: 1440, height: 900 },
      });
    },
  });
  const result = await controller.advance({
    capability,
    attempt_id: attemptId,
    turn_ordinal: turnOrdinal,
    binding,
  });
  report(result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
    .catch((error: unknown) => {
      report({ terminal: "HOLD", reason_code: stableErrorCode(error) });
      process.exitCode = 2;
    })
    .finally(closeWorkspaceIdentityRuntime);
}
