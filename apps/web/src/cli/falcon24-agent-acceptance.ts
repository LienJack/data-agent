import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildFalcon24AgentAnalysisAcceptanceSuite } from "@data-agent/evals";
import {
  loadRuntimeEnvironment,
  resolveRuntimeRepositoryRoot,
} from "@data-agent/platform/runtime-config";
import { z } from "zod";
import { deriveRunCommandIdentities } from "@/lib/run-command-identity";
import {
  closeWorkspaceIdentityRuntime,
  getEffectiveConfigResolver,
  getWorkspaceAuthority,
  getWorkspaceDataRepository,
} from "@/lib/workspace-identity";
import { startQuestionRun } from "@/server/qa/start-question-run";

const scopeSchema = z.strictObject({
  deploymentId: z.uuid(),
  workspaceId: z.uuid(),
  principalId: z.uuid(),
});
const variantSchema = z.enum(["COLD", "WARM"]);
const campaignIdSchema = z
  .string()
  .min(8)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._-]+$/u);

function stableUuid(material: string): string {
  const digits = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  digits[12] = "5";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function argument(name: string): string | undefined {
  const direct = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (direct) return direct.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireValue<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly code: string } },
): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function report(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function runIdentity(input: {
  readonly workspaceId: string;
  readonly principalId: string;
  readonly campaignId: string;
  readonly caseId: string;
  readonly variant: "COLD" | "WARM";
  readonly repetition: number;
}) {
  const material = `${input.campaignId}:${input.caseId}:${input.variant}:${input.repetition}`;
  const idempotencyKey = stableUuid(`falcon24:agent-acceptance:${material}`);
  return {
    ...deriveRunCommandIdentities({
      workspace_id: input.workspaceId,
      principal_id: input.principalId,
      idempotency_key: idempotencyKey,
    }),
    idempotencyKey,
    conversationId: stableUuid(`falcon24:agent-acceptance:conversation:${material}`),
  };
}

async function main(): Promise<void> {
  const root = resolveRuntimeRepositoryRoot(process.cwd());
  const environment = loadRuntimeEnvironment({ cwd: root, environment: process.env }).environment;
  Object.assign(process.env, environment);
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
  const authority = getWorkspaceAuthority();
  const capability = requireValue(
    await authority.resolveForServerContext({
      deployment_id: scope.deploymentId,
      workspace_id: scope.workspaceId,
      principal_id: scope.principalId,
      access: "WRITE",
    }),
  );
  const suite = await buildFalcon24AgentAnalysisAcceptanceSuite();
  const command = process.argv[2];
  const campaignId = campaignIdSchema.parse(argument("campaign-id"));

  if (command === "manifest") {
    const runs = suite.cases.flatMap((testCase) =>
      (["COLD", "WARM"] as const).flatMap((variant) =>
        [1, 2, 3].map((repetition) => ({
          run_id: runIdentity({
            workspaceId: scope.workspaceId,
            principalId: scope.principalId,
            campaignId,
            caseId: testCase.case_id,
            variant,
            repetition,
          }).run_id,
          case_id: testCase.case_id,
          run_variant: variant,
          repetition,
        })),
      ),
    );
    const outputPath = resolve(
      root,
      argument("output") ?? "artifacts/falcon24-agent-analysis/run-manifest.json",
    );
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(
        { schema_version: "falcon24-analysis-run-manifest@1.0.0", runs },
        null,
        2,
      )}\n`,
      "utf8",
    );
    report({
      terminal: "READY",
      campaign_id: campaignId,
      run_count: runs.length,
      output_path: outputPath,
    });
    return;
  }

  const caseId = argument("case-id");
  const testCase = suite.cases.find((candidate) => candidate.case_id === caseId);
  const variant = variantSchema.parse(argument("variant"));
  const repetition = z.coerce.number().int().min(1).max(3).parse(argument("repetition"));
  if (!testCase) throw new Error("FALCON24_ANALYSIS_CASE_UNKNOWN");
  const identities = runIdentity({
    workspaceId: scope.workspaceId,
    principalId: scope.principalId,
    campaignId,
    caseId: testCase.case_id,
    variant,
    repetition,
  });
  const defaults = requireValue(
    await getEffectiveConfigResolver().getWorkspaceDefaults(capability),
  );
  if (!defaults?.revision.defaults.model || !defaults.revision.defaults.datasource) {
    throw new Error("FALCON24_ANALYSIS_DEFAULTS_REQUIRED");
  }
  const conversations = getWorkspaceDataRepository();
  const existing = requireValue(
    await conversations.getConversation(capability, identities.conversationId),
  );
  if (!existing) {
    requireValue(
      await conversations.createConversation(capability, {
        schema_version: "workspace-conversation-create@1.0.0",
        conversation_id: identities.conversationId,
        title: `Falcon24 ${campaignId} ${testCase.case_id} ${variant}-${repetition}`,
        datasource_id: defaults.revision.defaults.datasource.resource_id,
        model_id: null,
        model_profile_id: defaults.revision.defaults.model.resource_id,
      }),
    );
  }
  if (command === "status") {
    const result = await getWorkspaceDataRepository().getRunBinding(capability, identities.run_id);
    report({
      terminal: "READY",
      campaign_id: campaignId,
      case_id: testCase.case_id,
      run_variant: variant,
      repetition,
      run_id: identities.run_id,
      binding: requireValue(result),
    });
    return;
  }
  if (command !== "submit") throw new Error("FALCON24_ANALYSIS_COMMAND_INVALID");
  const submitted = await startQuestionRun({
    capability,
    conversation_id: identities.conversationId,
    files: [],
    idempotency_key: identities.idempotencyKey,
    principal_id: scope.principalId,
    question: testCase.question,
    rollout_bootstrap_mode: environment.DATA_AGENT_DISPATCH_BOOTSTRAP_MODE,
    scope: capability.scope,
    workspace_id: scope.workspaceId,
  });
  if (submitted.kind !== "CREATED") {
    throw new Error(
      submitted.kind === "ERROR" ? submitted.error.code : "FALCON24_ANALYSIS_RESOLUTION_REQUIRED",
    );
  }
  report({
    terminal: "SUBMITTED",
    campaign_id: campaignId,
    case_id: testCase.case_id,
    run_variant: variant,
    repetition,
    run_id: identities.run_id,
    projection: submitted.projection,
  });
}

await main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "FALCON24_ANALYSIS_CONTROL_FAILED";
    report({
      terminal: "HOLD",
      reason_code: /^[A-Z][A-Z0-9_:-]{2,255}$/u.test(message)
        ? message
        : "FALCON24_ANALYSIS_CONTROL_FAILED",
    });
    process.exitCode = 2;
  })
  .finally(async () => {
    await closeWorkspaceIdentityRuntime();
  });
