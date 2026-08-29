import { z } from "zod";
import { artifactReferenceSchema } from "../artifacts/envelope.js";
import {
  contentHashSchema,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
} from "../common/index.js";
import { falcon24SuccessorAuthorityEpochSchema } from "../runs/falcon24-authority-identity.js";

export const FALCON24_FOUR_LAYER_GATE_MANIFEST_VERSION =
  "falcon24-four-layer-gate-manifest@1.0.0" as const;
export const FALCON24_FOUR_LAYER_LAYER_ORDER = Object.freeze(["L1", "L2", "L3", "L4"] as const);
export const FALCON24_FOUR_LAYER_LAYER_TURN_COUNTS = Object.freeze({
  L1: 5,
  L2: 2,
  L3: 2,
  L4: 6,
} as const);

const PROFILE_IDS = [
  "governed-analysis-agent",
  "governed-text2sql-agent",
  "report-writing-agent",
  "semantic-management-agent",
] as const;

export const falcon24FourLayerProfileIdSchema = z.enum(PROFILE_IDS);
export const falcon24FourLayerSchema = z.enum(FALCON24_FOUR_LAYER_LAYER_ORDER);
export const falcon24FourLayerGateIdSchema = z
  .string()
  .regex(
    /^E[1-9][0-9]*-FL1$/u,
    "Falcon24 four-layer gate 必须使用 canonical <epoch>-FL1 identity。",
  );

const expectedAgentContractSchema = z
  .strictObject({
    mode: z.enum(["EXACT", "DYNAMIC"]),
    required_profile_ids: z.array(falcon24FourLayerProfileIdSchema).min(1).max(8),
    allowed_profile_ids: z.array(falcon24FourLayerProfileIdSchema).min(1).max(PROFILE_IDS.length),
    min_agent_tasks: z.number().int().positive().max(12),
    max_agent_tasks: z.number().int().positive().max(12),
  })
  .superRefine((contract, context) => {
    const allowed = contract.allowed_profile_ids;
    if (
      new Set(contract.required_profile_ids).size !== contract.required_profile_ids.length ||
      new Set(allowed).size !== allowed.length ||
      allowed.some((value, index) => index > 0 && value <= (allowed[index - 1] ?? "")) ||
      contract.required_profile_ids.some((profileId) => !allowed.includes(profileId)) ||
      contract.min_agent_tasks > contract.max_agent_tasks
    ) {
      context.addIssue({ code: "custom", message: "Falcon24 Agent contract 拓扑无效。" });
    }
    if (
      contract.mode === "EXACT" &&
      (contract.min_agent_tasks !== contract.required_profile_ids.length ||
        contract.max_agent_tasks !== contract.required_profile_ids.length)
    ) {
      context.addIssue({ code: "custom", message: "EXACT Agent contract 必须冻结精确任务数。" });
    }
  });

const rubricSchema = z.strictObject({
  rubric_id: z.string().regex(/^falcon24\.fl\.[a-z0-9.-]+@1$/u),
  required_checks: z
    .array(z.string().regex(/^falcon24\.check\.[a-z0-9.-]+@1$/u))
    .min(1)
    .max(32),
  table_required: z.boolean(),
  chart_required: z.boolean(),
  accepted_input_required: z.boolean(),
  current_run_evidence_required: z.boolean(),
  forbidden_answer_phrases: z.array(z.string().min(1).max(160)).max(16),
});

function expectedAgents(
  mode: "EXACT" | "DYNAMIC",
  requiredProfileIds: readonly (typeof PROFILE_IDS)[number][],
  options: {
    readonly allowed?: readonly (typeof PROFILE_IDS)[number][];
    readonly min?: number;
    readonly max?: number;
  } = {},
) {
  return {
    mode,
    required_profile_ids: [...requiredProfileIds],
    allowed_profile_ids: [...(options.allowed ?? [...new Set(requiredProfileIds)].sort())],
    min_agent_tasks: options.min ?? requiredProfileIds.length,
    max_agent_tasks: options.max ?? requiredProfileIds.length,
  } as const;
}

const DYNAMIC_PROFILES = PROFILE_IDS;
const SAFE_ANSWER_PHRASES = ["BLOCKED", "索引未找到", "未受治理定义"] as const;

function rubric(
  id: string,
  checks: readonly string[],
  options: {
    readonly table?: boolean;
    readonly chart?: boolean;
    readonly acceptedInput?: boolean;
    readonly currentRunEvidence?: boolean;
    readonly forbidden?: readonly string[];
  } = {},
) {
  return {
    rubric_id: `falcon24.fl.${id}@1`,
    required_checks: checks.map((check) => `falcon24.check.${check}@1`),
    table_required: options.table ?? false,
    chart_required: options.chart ?? false,
    accepted_input_required: options.acceptedInput ?? false,
    current_run_evidence_required: options.currentRunEvidence ?? true,
    forbidden_answer_phrases: [...(options.forbidden ?? SAFE_ANSWER_PHRASES)],
  } as const;
}

/**
 * Public, user-visible bank only. Gold SQL and sealed Oracle material must never
 * be added here because the manifest is available to the production controller.
 */
export const FALCON24_FOUR_LAYER_TURN_BLUEPRINTS = Object.freeze([
  {
    ordinal: 0,
    turn_id: "L1-01",
    layer: "L1",
    scenario_id: "l1-semantic-yoy-definition",
    scenario_turn_index: 0,
    conversation_group: null,
    conversation_mode: "INDEPENDENT",
    question: "我想看订单收入的同比增长，系统里应该怎么算？需要使用哪些收入和时间口径？",
    expected_agents: expectedAgents("EXACT", ["semantic-management-agent"]),
    rubric: rubric("l1.semantic-yoy-definition", [
      "published-order-revenue",
      "published-time-grain",
      "request-scoped-yoy",
      "friendly-semantic-fallback",
    ]),
  },
  {
    ordinal: 1,
    turn_id: "L1-02",
    layer: "L1",
    scenario_id: "l1-semantic-aov-definition",
    scenario_turn_index: 0,
    conversation_group: null,
    conversation_mode: "INDEPENDENT",
    question: "当前工作区里的“客单价”是怎样计算的？它与客户订单总金额有什么区别？",
    expected_agents: expectedAgents("EXACT", ["semantic-management-agent"]),
    rubric: rubric("l1.semantic-aov-definition", [
      "published-aov-definition",
      "customer-cumulative-distinction",
    ]),
  },
  {
    ordinal: 2,
    turn_id: "L1-03",
    layer: "L1",
    scenario_id: "l1-semantic-relationships",
    scenario_turn_index: 0,
    conversation_group: null,
    conversation_mode: "INDEPENDENT",
    question: "订单、客户、客户反馈和配送信息之间怎样关联？",
    expected_agents: expectedAgents("EXACT", ["semantic-management-agent"]),
    rubric: rubric("l1.semantic-relationships", [
      "published-relationship-closure",
      "relationship-direction",
      "governed-join-keys",
    ]),
  },
  {
    ordinal: 3,
    turn_id: "L1-04",
    layer: "L1",
    scenario_id: "l1-text2sql-recent-orders",
    scenario_turn_index: 0,
    conversation_group: null,
    conversation_mode: "INDEPENDENT",
    question: "列出最近10笔订单的订单编号、下单日期和订单金额。",
    expected_agents: expectedAgents("EXACT", ["governed-text2sql-agent"]),
    rubric: rubric(
      "l1.text2sql-recent-orders",
      ["latest-ten-orders", "required-order-columns", "bounded-query-evidence"],
      { table: true },
    ),
  },
  {
    ordinal: 4,
    turn_id: "L1-05",
    layer: "L1",
    scenario_id: "l1-report-injected-table",
    scenario_turn_index: 0,
    conversation_group: null,
    conversation_mode: "INDEPENDENT",
    question: "基于这份已经确认的数据表，写一段给经营负责人的简短摘要，不增加表中没有的结论。",
    expected_agents: expectedAgents("EXACT", ["report-writing-agent"]),
    rubric: rubric(
      "l1.report-injected-table",
      ["accepted-table-only", "management-summary", "no-unsupported-claims"],
      { acceptedInput: true },
    ),
  },
  {
    ordinal: 5,
    turn_id: "L2-01",
    layer: "L2",
    scenario_id: "l2-monthly-yoy",
    scenario_turn_index: 0,
    conversation_group: null,
    conversation_mode: "INDEPENDENT",
    question: "最近12个完整月的订单收入同比表现如何？按月给出本期收入、上年同期收入和同比增速。",
    expected_agents: expectedAgents("EXACT", [
      "semantic-management-agent",
      "governed-text2sql-agent",
    ]),
    rubric: rubric(
      "l2.monthly-yoy",
      [
        "twelve-complete-months",
        "semantic-before-text2sql",
        "monthly-current-prior-yoy",
        "yoy-zero-denominator",
      ],
      { table: true },
    ),
  },
  {
    ordinal: 6,
    turn_id: "L2-02",
    layer: "L2",
    scenario_id: "l2-channel-roas",
    scenario_turn_index: 0,
    conversation_group: null,
    conversation_mode: "INDEPENDENT",
    question: "各营销渠道投入产出表现如何？按正式口径给出总投入、营销收入和ROAS渠道对比表。",
    expected_agents: expectedAgents("EXACT", [
      "semantic-management-agent",
      "governed-text2sql-agent",
    ]),
    rubric: rubric(
      "l2.channel-roas",
      [
        "semantic-before-text2sql",
        "aggregate-spend",
        "aggregate-marketing-revenue",
        "roas-ratio-of-sums",
        "roas-zero-denominator",
      ],
      { table: true },
    ),
  },
  {
    ordinal: 7,
    turn_id: "L3-01",
    layer: "L3",
    scenario_id: "l3-monthly-trend",
    scenario_turn_index: 0,
    conversation_group: null,
    conversation_mode: "INDEPENDENT",
    question: "最近12个完整月的订单收入有没有持续上升或下降？说明趋势强度，给出折线图和经营结论。",
    expected_agents: expectedAgents(
      "DYNAMIC",
      [
        "semantic-management-agent",
        "governed-text2sql-agent",
        "governed-analysis-agent",
        "report-writing-agent",
      ],
      { allowed: DYNAMIC_PROFILES, min: 4, max: 6 },
    ),
    rubric: rubric(
      "l3.monthly-trend",
      [
        "twelve-complete-months",
        "trend-strength",
        "accepted-analysis-evidence",
        "line-chart-source-lineage",
        "management-conclusion",
      ],
      { table: true, chart: true },
    ),
  },
  {
    ordinal: 8,
    turn_id: "L3-02",
    layer: "L3",
    scenario_id: "l3-marketing-effect",
    scenario_turn_index: 0,
    conversation_group: null,
    conversation_mode: "INDEPENDENT",
    question:
      "过去一年各营销渠道投入效果如何？比较不同渠道和目标人群的投入、转化与回报，并结合订单收入、新客和订单量，指出值得继续投入和需要收缩的渠道。",
    expected_agents: expectedAgents(
      "DYNAMIC",
      [
        "semantic-management-agent",
        "governed-text2sql-agent",
        "governed-analysis-agent",
        "report-writing-agent",
      ],
      { allowed: DYNAMIC_PROFILES, min: 4, max: 6 },
    ),
    rubric: rubric(
      "l3.marketing-effect",
      [
        "channel-audience-comparison",
        "marketing-business-linkage",
        "accepted-analysis-evidence",
        "correlation-not-causation",
        "table-chart-source-lineage",
      ],
      { table: true, chart: true },
    ),
  },
  {
    ordinal: 9,
    turn_id: "L4-A-01",
    layer: "L4",
    scenario_id: "l4-yoy-conversation",
    scenario_turn_index: 0,
    conversation_group: "L4-A",
    conversation_mode: "SHARED_SCENARIO",
    question: "最近12个完整月的订单收入同比表现如何？请给出月度趋势图。",
    expected_agents: expectedAgents(
      "DYNAMIC",
      ["semantic-management-agent", "governed-text2sql-agent", "report-writing-agent"],
      { allowed: DYNAMIC_PROFILES, min: 3, max: 5 },
    ),
    rubric: rubric(
      "l4.a.monthly-yoy",
      [
        "twelve-complete-months",
        "monthly-current-prior-yoy",
        "monthly-trend-chart",
        "conversation-evidence-boundary",
      ],
      { table: true, chart: true },
    ),
  },
  {
    ordinal: 10,
    turn_id: "L4-A-02",
    layer: "L4",
    scenario_id: "l4-yoy-conversation",
    scenario_turn_index: 1,
    conversation_group: "L4-A",
    conversation_mode: "SHARED_SCENARIO",
    question: "其中下降最明显的3个月，按客户类型拆开看看，主要差异来自哪里？",
    expected_agents: expectedAgents(
      "DYNAMIC",
      ["semantic-management-agent", "governed-text2sql-agent", "governed-analysis-agent"],
      { allowed: DYNAMIC_PROFILES, min: 3, max: 5 },
    ),
    rubric: rubric(
      "l4.a.customer-segment-decomposition",
      [
        "pronoun-resolves-prior-yoy",
        "three-largest-declines",
        "customer-segment-decomposition",
        "current-run-fact-verification",
      ],
      { table: true },
    ),
  },
  {
    ordinal: 11,
    turn_id: "L4-A-03",
    layer: "L4",
    scenario_id: "l4-yoy-conversation",
    scenario_turn_index: 2,
    conversation_group: "L4-A",
    conversation_mode: "SHARED_SCENARIO",
    question: "把总体趋势和这3个月的拆解合成一份经营摘要，保留原趋势图，再增加客户类型对比图。",
    expected_agents: expectedAgents(
      "DYNAMIC",
      ["semantic-management-agent", "governed-text2sql-agent", "report-writing-agent"],
      { allowed: DYNAMIC_PROFILES, min: 3, max: 6 },
    ),
    rubric: rubric(
      "l4.a.combined-report",
      [
        "three-month-reference-closure",
        "current-run-fact-verification",
        "management-summary",
        "preserved-trend-chart",
        "customer-segment-chart",
      ],
      { table: true, chart: true },
    ),
  },
  {
    ordinal: 12,
    turn_id: "L4-B-01",
    layer: "L4",
    scenario_id: "l4-marketing-conversation",
    scenario_turn_index: 0,
    conversation_group: "L4-B",
    conversation_mode: "SHARED_SCENARIO",
    question: "各营销渠道的总投入、营销收入和ROAS表现如何？给出渠道对比图。",
    expected_agents: expectedAgents(
      "DYNAMIC",
      ["semantic-management-agent", "governed-text2sql-agent", "report-writing-agent"],
      { allowed: DYNAMIC_PROFILES, min: 3, max: 5 },
    ),
    rubric: rubric(
      "l4.b.channel-roas",
      [
        "aggregate-spend",
        "aggregate-marketing-revenue",
        "roas-ratio-of-sums",
        "channel-comparison-chart",
      ],
      { table: true, chart: true },
    ),
  },
  {
    ordinal: 13,
    turn_id: "L4-B-02",
    layer: "L4",
    scenario_id: "l4-marketing-conversation",
    scenario_turn_index: 1,
    conversation_group: "L4-B",
    conversation_mode: "SHARED_SCENARIO",
    question: "我说的回报不是ROAS，改成净ROI，也就是扣除投入后的回报率，再按渠道重算。",
    expected_agents: expectedAgents(
      "DYNAMIC",
      ["semantic-management-agent", "governed-text2sql-agent", "report-writing-agent"],
      { allowed: DYNAMIC_PROFILES, min: 3, max: 5 },
    ),
    rubric: rubric(
      "l4.b.net-roi-correction",
      [
        "correction-overrides-roas",
        "net-roi-ratio-of-sums",
        "net-roi-zero-denominator",
        "channel-recalculation",
      ],
      { table: true },
    ),
  },
  {
    ordinal: 14,
    turn_id: "L4-B-03",
    layer: "L4",
    scenario_id: "l4-marketing-conversation",
    scenario_turn_index: 2,
    conversation_group: "L4-B",
    conversation_mode: "SHARED_SCENARIO",
    question: "只看投入增长但净ROI下降的渠道，再按目标人群拆开，说明可能原因和下一步建议。",
    expected_agents: expectedAgents(
      "DYNAMIC",
      [
        "semantic-management-agent",
        "governed-text2sql-agent",
        "governed-analysis-agent",
        "report-writing-agent",
      ],
      { allowed: DYNAMIC_PROFILES, min: 4, max: 6 },
    ),
    rubric: rubric(
      "l4.b.audience-decomposition",
      [
        "net-roi-correction-retained",
        "spend-up-net-roi-down-filter",
        "target-audience-decomposition",
        "correlation-not-causation",
        "actionable-recommendations",
      ],
      { table: true },
    ),
  },
] as const);

const manifestTurnSchema = z.strictObject({
  ordinal: z.number().int().min(0).max(14),
  turn_id: z.string().regex(/^L[1-4](?:-[AB])?-0[1-5]$/u),
  layer: falcon24FourLayerSchema,
  scenario_id: z.string().regex(/^l[1-4]-[a-z0-9-]+$/u),
  scenario_turn_index: z.number().int().min(0).max(2),
  conversation_group: z.enum(["L4-A", "L4-B"]).nullable(),
  conversation_mode: z.enum(["INDEPENDENT", "SHARED_SCENARIO"]),
  question: z.string().trim().min(1).max(8_000),
  question_hash: contentHashSchema,
  expected_agents: expectedAgentContractSchema,
  rubric: rubricSchema,
});

function compareFrozenTurns(
  turns: readonly z.infer<typeof manifestTurnSchema>[],
  context: z.RefinementCtx,
): void {
  const counts = Object.fromEntries(
    FALCON24_FOUR_LAYER_LAYER_ORDER.map((layer) => [
      layer,
      turns.filter((turn) => turn.layer === layer).length,
    ]),
  );
  const questions = turns.map(({ question }) => question);
  const questionHashes = turns.map(({ question_hash: questionHash }) => questionHash);
  if (
    questions.length !== 15 ||
    new Set(questions).size !== 15 ||
    new Set(questionHashes).size !== 15 ||
    FALCON24_FOUR_LAYER_LAYER_ORDER.some(
      (layer) => counts[layer] !== FALCON24_FOUR_LAYER_LAYER_TURN_COUNTS[layer],
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Falcon24 four-layer bank 必须精确为5/2/2/6且15题唯一。",
      path: ["turns"],
    });
  }
  turns.forEach((turn, index) => {
    const blueprint = FALCON24_FOUR_LAYER_TURN_BLUEPRINTS[index];
    if (!blueprint) return;
    const { question_hash: _questionHash, ...material } = turn;
    if (JSON.stringify(material) !== JSON.stringify(blueprint)) {
      context.addIssue({
        code: "custom",
        message: "Falcon24 turn 与冻结题库不一致。",
        path: ["turns", index],
      });
    }
  });
}

const manifestMaterialSchema = z
  .strictObject({
    schema_version: z.literal(FALCON24_FOUR_LAYER_GATE_MANIFEST_VERSION),
    gate_id: falcon24FourLayerGateIdSchema,
    attempt_id: immutableIdSchema,
    authority_epoch: falcon24SuccessorAuthorityEpochSchema,
    authority_baseline_id: immutableIdSchema,
    authority_baseline_hash: contentHashSchema,
    authority_activation_attempt_id: immutableIdSchema,
    source_commit: z.string().regex(/^[0-9a-f]{40}$/u),
    worker_build_hash: contentHashSchema,
    worker_generation_hash: contentHashSchema,
    web_build_hash: contentHashSchema,
    web_generation_hash: contentHashSchema,
    semantic_release_hash: contentHashSchema,
    datasource_binding_hash: contentHashSchema,
    model_config_hash: contentHashSchema,
    runtime_attestation_hash: contentHashSchema,
    turns: z.array(manifestTurnSchema).length(15),
  })
  .superRefine((manifest, context) => {
    if (manifest.gate_id !== `${manifest.authority_epoch}-FL1`) {
      context.addIssue({
        code: "custom",
        message: "four-layer gate_id 必须由 authority_epoch 派生。",
        path: ["gate_id"],
      });
    }
    compareFrozenTurns(manifest.turns, context);
  });

export const falcon24FourLayerGateManifestSchema = manifestMaterialSchema.extend({
  manifest_hash: contentHashSchema,
});

export async function buildFalcon24FourLayerManifestTurns() {
  return Promise.all(
    FALCON24_FOUR_LAYER_TURN_BLUEPRINTS.map(async (turn) =>
      manifestTurnSchema.parse({
        ...turn,
        question_hash: await sha256ContentHash(turn.question),
      }),
    ),
  );
}

async function assertManifestQuestionHashes(
  turns: readonly z.infer<typeof manifestTurnSchema>[],
): Promise<void> {
  const hashes = await Promise.all(turns.map(({ question }) => sha256ContentHash(question)));
  if (turns.some((turn, index) => turn.question_hash !== hashes[index])) {
    throw new TypeError("FALCON24_FOUR_LAYER_QUESTION_HASH_INVALID");
  }
}

export async function buildFalcon24FourLayerGateManifest(input: unknown) {
  const material = manifestMaterialSchema.parse(input);
  await assertManifestQuestionHashes(material.turns);
  return falcon24FourLayerGateManifestSchema.parse({
    ...material,
    manifest_hash: await sha256ContentHash(material),
  });
}

export async function verifyFalcon24FourLayerGateManifest(input: unknown) {
  const manifest = falcon24FourLayerGateManifestSchema.parse(input);
  await assertManifestQuestionHashes(manifest.turns);
  const { manifest_hash: observedHash, ...material } = manifest;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_FOUR_LAYER_MANIFEST_HASH_INVALID");
  }
  return manifest;
}

export function falcon24FourLayerAgentContractMatches(
  contractInput: unknown,
  actualProfileIdsInput: unknown,
): boolean {
  const contract = expectedAgentContractSchema.parse(contractInput);
  const parsedActual = z
    .array(falcon24FourLayerProfileIdSchema)
    .min(1)
    .max(12)
    .safeParse(actualProfileIdsInput);
  if (!parsedActual.success) return false;
  const actual = parsedActual.data;
  if (
    actual.length < contract.min_agent_tasks ||
    actual.length > contract.max_agent_tasks ||
    actual.some((profileId) => !contract.allowed_profile_ids.includes(profileId))
  ) {
    return false;
  }
  if (contract.mode === "EXACT") {
    return actual.every((profileId, index) => profileId === contract.required_profile_ids[index]);
  }
  const firstPositions = contract.required_profile_ids.map((profileId) =>
    actual.indexOf(profileId),
  );
  return firstPositions.every(
    (position, index) =>
      position >= 0 && (index === 0 || position > (firstPositions[index - 1] ?? -1)),
  );
}

const failureCodeSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]{2,127}$/u);
const stagedStatusSchema = z.enum(["PASS", "FAIL"]);
const receiptIdentitySchema = z.strictObject({
  gate_id: falcon24FourLayerGateIdSchema,
  attempt_id: immutableIdSchema,
  manifest_hash: contentHashSchema,
  turn_ordinal: z.number().int().min(0).max(14),
  turn_id: z.string().min(3).max(16),
  layer: falcon24FourLayerSchema,
  scenario_id: z.string().min(3).max(128),
  scenario_turn_index: z.number().int().min(0).max(2),
  conversation_id: immutableIdSchema,
  conversation_resource_version: z.number().int().positive().safe(),
  run_id: immutableIdSchema,
  question_hash: contentHashSchema,
  worker_build_hash: contentHashSchema,
  worker_generation_hash: contentHashSchema,
  semantic_release_hash: contentHashSchema,
});

const rubricResultSchema = z.strictObject({
  check_id: z.string().regex(/^falcon24\.check\.[a-z0-9.-]+@1$/u),
  status: stagedStatusSchema,
  evidence_hash: contentHashSchema,
});

function addStatusFailureIssue(
  document: { readonly status: "PASS" | "FAIL"; readonly failure_code: string | null },
  context: z.RefinementCtx,
): void {
  if ((document.status === "PASS") !== (document.failure_code === null)) {
    context.addIssue({
      code: "custom",
      message: "PASS必须无failure_code，FAIL必须有failure_code。",
      path: ["failure_code"],
    });
  }
}

const businessReceiptMaterialSchema = z
  .strictObject({
    schema_version: z.literal("falcon24-four-layer-business-receipt@1.0.0"),
    ...receiptIdentitySchema.shape,
    answer_hash: contentHashSchema,
    public_event_hash: contentHashSchema,
    actual_profile_ids: z.array(falcon24FourLayerProfileIdSchema).min(1).max(12),
    accepted_artifact_refs: z.array(artifactReferenceSchema).max(64),
    rubric_results: z.array(rubricResultSchema).min(1).max(32),
    status: stagedStatusSchema,
    failure_code: failureCodeSchema.nullable(),
    evaluated_at: timestampSchema,
  })
  .superRefine((receipt, context) => {
    addStatusFailureIssue(receipt, context);
    if (receipt.accepted_artifact_refs.some(({ run_id: runId }) => runId !== receipt.run_id)) {
      context.addIssue({
        code: "custom",
        message: "Business Artifact必须属于exact Run。",
        path: ["accepted_artifact_refs"],
      });
    }
  });

export const falcon24FourLayerBusinessReceiptSchema = businessReceiptMaterialSchema.extend({
  receipt_hash: contentHashSchema,
});

const qaUiReceiptMaterialSchema = z
  .strictObject({
    schema_version: z.literal("falcon24-four-layer-qa-ui-receipt@1.0.0"),
    ...receiptIdentitySchema.shape,
    answer_hash: contentHashSchema,
    web_build_hash: contentHashSchema,
    web_generation_hash: contentHashSchema,
    composer_submission_count: z.literal(1),
    terminal_answer_visible: z.boolean(),
    error_banner: z.string().max(2_000).nullable(),
    dom_snapshot_hash: contentHashSchema,
    screenshot_hash: contentHashSchema,
    status: stagedStatusSchema,
    failure_code: failureCodeSchema.nullable(),
    observed_at: timestampSchema,
  })
  .superRefine(addStatusFailureIssue);

export const falcon24FourLayerQaUiReceiptSchema = qaUiReceiptMaterialSchema.extend({
  receipt_hash: contentHashSchema,
});

const traceUiReceiptMaterialSchema = z
  .strictObject({
    schema_version: z.literal("falcon24-four-layer-trace-ui-receipt@1.0.0"),
    ...receiptIdentitySchema.shape,
    web_build_hash: contentHashSchema,
    web_generation_hash: contentHashSchema,
    answer_entry_clicked: z.boolean(),
    exact_run_focused: z.boolean(),
    public_event_hash: contentHashSchema,
    accepted_artifact_refs_hash: contentHashSchema,
    dom_snapshot_hash: contentHashSchema,
    screenshot_hash: contentHashSchema,
    status: stagedStatusSchema,
    failure_code: failureCodeSchema.nullable(),
    observed_at: timestampSchema,
  })
  .superRefine(addStatusFailureIssue);

export const falcon24FourLayerTraceUiReceiptSchema = traceUiReceiptMaterialSchema.extend({
  receipt_hash: contentHashSchema,
});

const terminalReceiptMaterialSchema = z
  .strictObject({
    schema_version: z.literal("falcon24-four-layer-turn-terminal-receipt@1.0.0"),
    ...receiptIdentitySchema.shape,
    business_receipt_hash: contentHashSchema,
    qa_ui_receipt_hash: contentHashSchema.nullable(),
    trace_ui_receipt_hash: contentHashSchema.nullable(),
    status: z.enum(["PASS", "FAILED"]),
    failure_code: failureCodeSchema.nullable(),
    finalized_at: timestampSchema,
  })
  .superRefine((receipt, context) => {
    const passed = receipt.status === "PASS";
    if (
      passed !== (receipt.failure_code === null) ||
      (passed && (receipt.qa_ui_receipt_hash === null || receipt.trace_ui_receipt_hash === null))
    ) {
      context.addIssue({ code: "custom", message: "Terminal receipt阶段闭包无效。" });
    }
  });

export const falcon24FourLayerTerminalReceiptSchema = terminalReceiptMaterialSchema.extend({
  receipt_hash: contentHashSchema,
});

const attemptTerminalReceiptMaterialSchema = z
  .strictObject({
    schema_version: z.literal("falcon24-four-layer-attempt-terminal-receipt@1.0.0"),
    gate_id: falcon24FourLayerGateIdSchema,
    attempt_id: immutableIdSchema,
    manifest_hash: contentHashSchema,
    worker_build_hash: contentHashSchema,
    worker_generation_hash: contentHashSchema,
    web_build_hash: contentHashSchema,
    web_generation_hash: contentHashSchema,
    semantic_release_hash: contentHashSchema,
    turn_receipt_hashes: z.array(contentHashSchema).min(1).max(15),
    status: z.enum(["PASS", "FAILED"]),
    failure_code: failureCodeSchema.nullable(),
    finalized_at: timestampSchema,
  })
  .superRefine((receipt, context) => {
    const passed = receipt.status === "PASS";
    if (
      passed !== (receipt.failure_code === null) ||
      (passed &&
        (receipt.turn_receipt_hashes.length !== 15 ||
          new Set(receipt.turn_receipt_hashes).size !== 15))
    ) {
      context.addIssue({ code: "custom", message: "Attempt terminal receipt闭包无效。" });
    }
  });

export const falcon24FourLayerAttemptTerminalReceiptSchema =
  attemptTerminalReceiptMaterialSchema.extend({ receipt_hash: contentHashSchema });

async function buildReceipt<T extends z.ZodType>(schema: T, input: unknown) {
  const material = schema.parse(input) as Record<string, unknown>;
  return { ...material, receipt_hash: await sha256ContentHash(material) };
}

async function verifyReceipt<T extends z.ZodType>(schema: T, input: unknown) {
  const receipt = schema.parse(input) as z.infer<T> & { readonly receipt_hash: string };
  const { receipt_hash: observedHash, ...material } = receipt;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_FOUR_LAYER_RECEIPT_HASH_INVALID");
  }
  return receipt;
}

export async function buildFalcon24FourLayerBusinessReceipt(input: unknown) {
  return falcon24FourLayerBusinessReceiptSchema.parse(
    await buildReceipt(businessReceiptMaterialSchema, input),
  );
}
export async function buildFalcon24FourLayerQaUiReceipt(input: unknown) {
  return falcon24FourLayerQaUiReceiptSchema.parse(
    await buildReceipt(qaUiReceiptMaterialSchema, input),
  );
}
export async function buildFalcon24FourLayerTraceUiReceipt(input: unknown) {
  return falcon24FourLayerTraceUiReceiptSchema.parse(
    await buildReceipt(traceUiReceiptMaterialSchema, input),
  );
}
export async function buildFalcon24FourLayerTerminalReceipt(input: unknown) {
  return falcon24FourLayerTerminalReceiptSchema.parse(
    await buildReceipt(terminalReceiptMaterialSchema, input),
  );
}
export async function buildFalcon24FourLayerAttemptTerminalReceipt(input: unknown) {
  return falcon24FourLayerAttemptTerminalReceiptSchema.parse(
    await buildReceipt(attemptTerminalReceiptMaterialSchema, input),
  );
}
export async function verifyFalcon24FourLayerBusinessReceipt(input: unknown) {
  return verifyReceipt(falcon24FourLayerBusinessReceiptSchema, input);
}
export async function verifyFalcon24FourLayerQaUiReceipt(input: unknown) {
  return verifyReceipt(falcon24FourLayerQaUiReceiptSchema, input);
}
export async function verifyFalcon24FourLayerTraceUiReceipt(input: unknown) {
  return verifyReceipt(falcon24FourLayerTraceUiReceiptSchema, input);
}
export async function verifyFalcon24FourLayerTerminalReceipt(input: unknown) {
  return verifyReceipt(falcon24FourLayerTerminalReceiptSchema, input);
}
export async function verifyFalcon24FourLayerAttemptTerminalReceipt(input: unknown) {
  return verifyReceipt(falcon24FourLayerAttemptTerminalReceiptSchema, input);
}

const conversationBindingSchema = z.strictObject({
  turn_ordinal: z.number().int().min(0).max(14),
  turn_id: z.string().min(3).max(16),
  conversation_id: immutableIdSchema,
  conversation_resource_version: z.number().int().positive().safe(),
  run_id: immutableIdSchema,
});

export function verifyFalcon24FourLayerConversationBindings(
  manifestInput: unknown,
  bindingsInput: unknown,
) {
  const manifest = falcon24FourLayerGateManifestSchema.parse(manifestInput);
  const bindings = z.array(conversationBindingSchema).length(15).parse(bindingsInput);
  const runIds = bindings.map(({ run_id: runId }) => runId);
  const independentConversationIds = bindings
    .slice(0, 9)
    .map(({ conversation_id: conversationId }) => conversationId);
  const l4a = bindings.slice(9, 12);
  const l4b = bindings.slice(12, 15);
  const groupIsValid = (group: readonly z.infer<typeof conversationBindingSchema>[]) =>
    new Set(group.map(({ conversation_id: conversationId }) => conversationId)).size === 1 &&
    group.every(
      (binding, index) =>
        index === 0 ||
        binding.conversation_resource_version >
          (group[index - 1]?.conversation_resource_version ?? Number.MAX_SAFE_INTEGER),
    );
  if (
    bindings.some(
      (binding, index) =>
        binding.turn_ordinal !== index || binding.turn_id !== manifest.turns[index]?.turn_id,
    ) ||
    new Set(runIds).size !== 15 ||
    new Set(independentConversationIds).size !== 9 ||
    independentConversationIds.some(
      (conversationId) =>
        conversationId === l4a[0]?.conversation_id || conversationId === l4b[0]?.conversation_id,
    ) ||
    !groupIsValid(l4a) ||
    !groupIsValid(l4b) ||
    l4a[0]?.conversation_id === l4b[0]?.conversation_id
  ) {
    throw new TypeError("FALCON24_FOUR_LAYER_CONVERSATION_BINDING_INVALID");
  }
  return bindings;
}

function identityMaterial(value: z.infer<typeof receiptIdentitySchema>) {
  return receiptIdentitySchema.parse({
    gate_id: value.gate_id,
    attempt_id: value.attempt_id,
    manifest_hash: value.manifest_hash,
    turn_ordinal: value.turn_ordinal,
    turn_id: value.turn_id,
    layer: value.layer,
    scenario_id: value.scenario_id,
    scenario_turn_index: value.scenario_turn_index,
    conversation_id: value.conversation_id,
    conversation_resource_version: value.conversation_resource_version,
    run_id: value.run_id,
    question_hash: value.question_hash,
    worker_build_hash: value.worker_build_hash,
    worker_generation_hash: value.worker_generation_hash,
    semantic_release_hash: value.semantic_release_hash,
  });
}

function assertReceiptIdentity(
  manifest: z.infer<typeof falcon24FourLayerGateManifestSchema>,
  turn: z.infer<typeof manifestTurnSchema>,
  receipt: z.infer<typeof receiptIdentitySchema>,
): void {
  const expected = {
    gate_id: manifest.gate_id,
    attempt_id: manifest.attempt_id,
    manifest_hash: manifest.manifest_hash,
    turn_ordinal: turn.ordinal,
    turn_id: turn.turn_id,
    layer: turn.layer,
    scenario_id: turn.scenario_id,
    scenario_turn_index: turn.scenario_turn_index,
    question_hash: turn.question_hash,
    worker_build_hash: manifest.worker_build_hash,
    worker_generation_hash: manifest.worker_generation_hash,
    semantic_release_hash: manifest.semantic_release_hash,
  };
  if (
    Object.entries(expected).some(([key, value]) => receipt[key as keyof typeof receipt] !== value)
  ) {
    throw new TypeError("FALCON24_FOUR_LAYER_RECEIPT_MANIFEST_MISMATCH");
  }
}

function assertSameReceiptIdentity(
  expected: z.infer<typeof receiptIdentitySchema>,
  actual: z.infer<typeof receiptIdentitySchema>,
): void {
  if (JSON.stringify(identityMaterial(expected)) !== JSON.stringify(identityMaterial(actual))) {
    throw new TypeError("FALCON24_FOUR_LAYER_RECEIPT_IDENTITY_MISMATCH");
  }
}

export async function verifyFalcon24FourLayerTurnReceiptProgression(input: {
  readonly manifest: unknown;
  readonly business_receipt: unknown;
  readonly qa_ui_receipt?: unknown | null;
  readonly trace_ui_receipt?: unknown | null;
  readonly terminal_receipt?: unknown | null;
}) {
  const manifest = await verifyFalcon24FourLayerGateManifest(input.manifest);
  const business = await verifyReceipt(
    falcon24FourLayerBusinessReceiptSchema,
    input.business_receipt,
  );
  const turn = manifest.turns[business.turn_ordinal];
  if (!turn) throw new TypeError("FALCON24_FOUR_LAYER_TURN_NOT_FOUND");
  assertReceiptIdentity(manifest, turn, business);
  if (!falcon24FourLayerAgentContractMatches(turn.expected_agents, business.actual_profile_ids)) {
    throw new TypeError("FALCON24_FOUR_LAYER_AGENT_CONTRACT_MISMATCH");
  }
  const requiredChecks = turn.rubric.required_checks;
  if (
    business.rubric_results.length !== requiredChecks.length ||
    business.rubric_results.some(
      (result, index) =>
        result.check_id !== requiredChecks[index] ||
        (business.status === "PASS" && result.status !== "PASS"),
    )
  ) {
    throw new TypeError("FALCON24_FOUR_LAYER_RUBRIC_CLOSURE_INVALID");
  }

  const qa = input.qa_ui_receipt
    ? await verifyReceipt(falcon24FourLayerQaUiReceiptSchema, input.qa_ui_receipt)
    : null;
  const trace = input.trace_ui_receipt
    ? await verifyReceipt(falcon24FourLayerTraceUiReceiptSchema, input.trace_ui_receipt)
    : null;
  const terminal = input.terminal_receipt
    ? await verifyReceipt(falcon24FourLayerTerminalReceiptSchema, input.terminal_receipt)
    : null;

  for (const receipt of [qa, trace, terminal]) {
    if (!receipt) continue;
    assertReceiptIdentity(manifest, turn, receipt);
    assertSameReceiptIdentity(business, receipt);
  }
  for (const receipt of [qa, trace]) {
    if (
      receipt &&
      (receipt.web_build_hash !== manifest.web_build_hash ||
        receipt.web_generation_hash !== manifest.web_generation_hash)
    ) {
      throw new TypeError("FALCON24_FOUR_LAYER_WEB_BUILD_MISMATCH");
    }
  }
  if (business.status === "FAIL" && (qa || trace)) {
    throw new TypeError("FALCON24_FOUR_LAYER_UI_AFTER_BUSINESS_FAILURE");
  }
  if (trace && qa?.status !== "PASS") {
    throw new TypeError("FALCON24_FOUR_LAYER_TRACE_BEFORE_QA_PASS");
  }
  if (terminal) {
    if (terminal.business_receipt_hash !== business.receipt_hash) {
      throw new TypeError("FALCON24_FOUR_LAYER_TERMINAL_BUSINESS_MISMATCH");
    }
    if (terminal.qa_ui_receipt_hash !== (qa?.receipt_hash ?? null)) {
      throw new TypeError("FALCON24_FOUR_LAYER_TERMINAL_QA_MISMATCH");
    }
    if (terminal.trace_ui_receipt_hash !== (trace?.receipt_hash ?? null)) {
      throw new TypeError("FALCON24_FOUR_LAYER_TERMINAL_TRACE_MISMATCH");
    }
    if (
      terminal.status === "PASS" &&
      (business.status !== "PASS" || qa?.status !== "PASS" || trace?.status !== "PASS")
    ) {
      throw new TypeError("FALCON24_FOUR_LAYER_TERMINAL_PASS_INVALID");
    }
  }
  return { business, qa, trace, terminal };
}

export type Falcon24FourLayerManifestTurn = z.infer<typeof manifestTurnSchema>;
export type Falcon24FourLayerGateManifest = z.infer<typeof falcon24FourLayerGateManifestSchema>;
export type Falcon24FourLayerBusinessReceipt = z.infer<
  typeof falcon24FourLayerBusinessReceiptSchema
>;
export type Falcon24FourLayerQaUiReceipt = z.infer<typeof falcon24FourLayerQaUiReceiptSchema>;
export type Falcon24FourLayerTraceUiReceipt = z.infer<typeof falcon24FourLayerTraceUiReceiptSchema>;
export type Falcon24FourLayerTerminalReceipt = z.infer<
  typeof falcon24FourLayerTerminalReceiptSchema
>;
export type Falcon24FourLayerAttemptTerminalReceipt = z.infer<
  typeof falcon24FourLayerAttemptTerminalReceiptSchema
>;
