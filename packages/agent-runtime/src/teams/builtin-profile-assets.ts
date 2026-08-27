import {
  type AgentProductProfileRevisionV2,
  type AppScope,
  buildAgentProductProfileRevisionV2,
  buildSkillRevision,
  canonicalizeJson,
  sha256ContentHash,
  type VersionedResourceReference,
} from "@data-agent/contracts";
import {
  DATA_AGENT_SPECIALIST_PROFILE_IDS,
  type DataAgentSpecialistProfileId,
  getAgentProfileRevision,
} from "./agent-profiles.js";

export const BUILTIN_TEAM_SIGNER_ID = "00000000-0000-4000-8000-000000002001";

// Product Profile revisions are immutable publication revisions. They are
// intentionally independent from runtime Profile revisions: changing the
// discovery card, prompt, model binding, workflow, or policy must advance the
// product revision even when the referenced runtime Profile is unchanged.
export const BUILTIN_PRODUCT_PROFILE_REVISIONS = Object.freeze({
  "governed-analysis-agent": 4,
  "governed-text2sql-agent": 4,
  "report-writing-agent": 4,
  "semantic-management-agent": 6,
} as const satisfies Readonly<Record<DataAgentSpecialistProfileId, number>>);

const prompts = {
  "governed-analysis-agent":
    "You execute registered governed multi-step analyses from accepted QueryEvidence and an exact semantic closure. Python may orchestrate approved statistical operators, but cannot query datasources, reimplement governed operators, or publish unverified results.",
  "semantic-management-agent":
    "You select exact relationship, dependency, lineage, join, metric, dimension, formula, time, and quality IDs from the frozen published semantic release. The Host validates that selection and projects an immutable SemanticQueryContext; never author definitions, execute SQL, or mutate semantics.",
  "governed-text2sql-agent":
    "You consume the exact frozen published semantic release, schema snapshot, and datasource binding, then produce QueryEvidence only after the compiler, firewall, and real read-only adapter succeed. Never mutate semantics or fabricate rows.",
  "report-writing-agent":
    "You write reports only from accepted evidence references. Never access a datasource, execute SQL, or mutate semantic definitions.",
} as const satisfies Readonly<Record<DataAgentSpecialistProfileId, string>>;

const discovery = {
  "governed-analysis-agent": {
    display_name: "Governed Analysis Agent",
    description:
      "Consumes accepted QueryEvidence to run registered multi-step business analyses with DeepSeek-generated Python, fixed statistical operators, an independent Oracle, and a chart.",
    when_to_use: [
      "Use for multi-step diagnosis, attribution, trend testing, cohort analysis, lag analysis, or other requests that require governed statistical analysis and a chart.",
    ],
    when_not_to_use: [
      "Do not use for a simple database lookup, a semantic-definition question, or prose-only report formatting; first require accepted QueryEvidence from Text2SQL.",
    ],
    examples: [
      {
        request: "Analyze customer cohorts through M0-M6 and disclose timeline anomalies.",
        expected_use:
          "Consume accepted QueryEvidence, resolve a registered analysis from the semantic closure, run governed Python and operators, then return Oracle-accepted evidence and a chart.",
      },
    ],
    accepted_input_artifact_types: ["QueryEvidence"],
    access_mode: "READ_ONLY",
  },
  "semantic-management-agent": {
    display_name: "Semantic Management Agent",
    description:
      "Selects exact frozen semantic objects so the Host can publish a verified SemanticQueryContext.",
    when_to_use: [
      "Use for semantic relationships, dependencies, lineage, metric definitions, and semantic context.",
    ],
    when_not_to_use: [
      "Do not use for database values, aggregates, rankings, trends, rows, arbitrary SQL, or semantic mutations.",
    ],
    examples: [
      {
        request: "Explain dependencies between tables from the frozen relationship graph.",
        expected_use:
          "Select exact frozen Release relationship and lineage IDs; the Host projects their authoritative definitions without executing SQL.",
      },
    ],
    accepted_input_artifact_types: [],
    access_mode: "READ_ONLY",
  },
  "governed-text2sql-agent": {
    display_name: "Governed Text2SQL Agent",
    description:
      "Compiles and executes governed analytical queries against the frozen data context.",
    when_to_use: [
      "Use when the request requires database values, aggregates, rankings, trends, or rows.",
    ],
    when_not_to_use: ["Do not use for semantic graph relationships that require no SQL execution."],
    examples: [
      {
        request: "Show monthly sales trend for the current workspace.",
        expected_use: "Produce accepted QueryEvidence from governed SQL execution.",
      },
    ],
    accepted_input_artifact_types: [],
    access_mode: "READ_ONLY",
  },
  "report-writing-agent": {
    display_name: "Report Writing Agent",
    description: "Builds formal reports only from already accepted governed evidence.",
    when_to_use: [
      "Use after accepted QueryEvidence or analysis Artifacts exist and a formal report is requested.",
    ],
    when_not_to_use: [
      "Do not use without accepted input evidence and do not query databases directly.",
    ],
    examples: [
      {
        request: "Turn accepted sales evidence into a formal report.",
        expected_use: "Consume accepted evidence and produce an AnalysisReport.",
      },
    ],
    accepted_input_artifact_types: ["QueryEvidence"],
    access_mode: "READ_ONLY",
  },
} as const satisfies Readonly<
  Record<
    DataAgentSpecialistProfileId,
    {
      readonly display_name: string;
      readonly description: string;
      readonly when_to_use: readonly string[];
      readonly when_not_to_use: readonly string[];
      readonly examples: readonly { readonly request: string; readonly expected_use: string }[];
      readonly accepted_input_artifact_types: readonly ("QueryEvidence" | "AnalysisReport")[];
      readonly access_mode: "READ_ONLY";
    }
  >
>;

export const BUILTIN_TEAM_WORKFLOWS = {
  "governed-analysis-agent": [
    "resolve_semantic_program",
    "bind_accepted_query_evidence",
    "execute_generated_python",
    "verify_with_oracle",
    "project_chart",
    "complete",
  ],
  "semantic-management-agent": [
    "load_frozen_release",
    "select_exact_ids",
    "validate_selection",
    "project_semantic_query_context",
    "complete",
  ],
  "governed-text2sql-agent": [
    "resolve_context",
    "plan",
    "compile",
    "firewall",
    "execute",
    "bounded_repair",
    "complete",
  ],
  "report-writing-agent": [
    "load_accepted_evidence",
    "claims",
    "charts",
    "citations",
    "validate",
    "complete",
  ],
} as const satisfies Readonly<Record<DataAgentSpecialistProfileId, readonly string[]>>;

interface BuiltinSkillDefinition {
  readonly skill_id: string;
  readonly revision: number;
  readonly name: string;
  readonly profile_id: DataAgentSpecialistProfileId;
  readonly capabilities: readonly string[];
  readonly body: string;
}

export const BUILTIN_TEAM_SKILLS: readonly BuiltinSkillDefinition[] = [
  {
    skill_id: "00000000-0000-4000-8000-000000002401",
    revision: 2,
    name: "Governed Statistical Analysis",
    profile_id: "governed-analysis-agent",
    capabilities: ["analysis.program.execute"],
    body: "Execute an approved analysis program from the frozen semantic closure and an authoritative accepted QueryEvidence attachment: materialize that exact evidence for Python, orchestrate governed statistical operators, verify with an independent Oracle, and publish only accepted evidence and charts. Never query the datasource or generate replacement QueryEvidence.",
  },
  {
    skill_id: "00000000-0000-4000-8000-000000002101",
    revision: 2,
    name: "Frozen Semantic Definitions",
    profile_id: "semantic-management-agent",
    capabilities: ["semantic.catalog.read"],
    body: "Select exact metric, dimension, formula, time, and quality IDs from the frozen published semantic release so the Host can project a verified SemanticQueryContext. Never author definitions, write a candidate, or execute SQL.",
  },
  {
    skill_id: "00000000-0000-4000-8000-000000002102",
    revision: 2,
    name: "Frozen Semantic Relationships",
    profile_id: "semantic-management-agent",
    capabilities: ["semantic.catalog.read"],
    body: "Select exact join, dependency, cardinality, and relationship IDs from the frozen published semantic release so the Host can project their authoritative proof. Never infer database values.",
  },
  {
    skill_id: "00000000-0000-4000-8000-000000002103",
    revision: 2,
    name: "Frozen Semantic Lineage",
    profile_id: "semantic-management-agent",
    capabilities: ["semantic.catalog.read"],
    body: "Select exact physical and semantic lineage IDs from the frozen published semantic release; the Host preserves the retrieval and inference receipts in SemanticQueryContext. Never mutate definitions.",
  },
  {
    skill_id: "00000000-0000-4000-8000-000000002201",
    revision: 1,
    name: "Question to Query",
    profile_id: "governed-text2sql-agent",
    capabilities: ["semantic.release.read", "sql.compiler.compile"],
    body: "Resolve exact context and compile a grounded query from a published semantic release.",
  },
  {
    skill_id: "00000000-0000-4000-8000-000000002202",
    revision: 1,
    name: "Ambiguity Resolution",
    profile_id: "governed-text2sql-agent",
    capabilities: ["semantic.release.read"],
    body: "Detect material ambiguity and return a typed clarification instead of guessing.",
  },
  {
    skill_id: "00000000-0000-4000-8000-000000002203",
    revision: 1,
    name: "Bounded Query Repair",
    profile_id: "governed-text2sql-agent",
    capabilities: ["sql.compiler.compile", "sql.sandbox.execute"],
    body: "Repair only mechanically eligible query failures within the frozen attempt budget.",
  },
  {
    skill_id: "00000000-0000-4000-8000-000000002301",
    revision: 1,
    name: "Evidence to Report",
    profile_id: "report-writing-agent",
    capabilities: ["evidence.read", "report.project"],
    body: "Project accepted evidence into claims and a report without accessing raw data.",
  },
  {
    skill_id: "00000000-0000-4000-8000-000000002302",
    revision: 1,
    name: "Chart Selection",
    profile_id: "report-writing-agent",
    capabilities: ["report.project"],
    body: "Select chart forms from typed evidence shape and preserve every source reference.",
  },
  {
    skill_id: "00000000-0000-4000-8000-000000002303",
    revision: 1,
    name: "Claim Citation",
    profile_id: "report-writing-agent",
    capabilities: ["evidence.read", "report.project"],
    body: "Attach exact evidence references to supported claims and mark gaps unsupported.",
  },
];

export interface BuiltinTeamMaterializationInput {
  readonly scope: AppScope;
  readonly model_profile_refs: Readonly<
    Record<DataAgentSpecialistProfileId, VersionedResourceReference>
  >;
  readonly context_policy_refs: Readonly<
    Record<DataAgentSpecialistProfileId, VersionedResourceReference>
  >;
  readonly execution_safety_policy_refs: Readonly<
    Record<DataAgentSpecialistProfileId, VersionedResourceReference>
  >;
}

function resourceIdentity(reference: VersionedResourceReference): string {
  return `${reference.resource_id}:${reference.resource_revision}:${reference.resource_hash}`;
}

function assertDistinctProfileResources(
  values: Readonly<Record<DataAgentSpecialistProfileId, VersionedResourceReference>>,
  kind: string,
): void {
  const identities = Object.values(values).map(resourceIdentity);
  if (new Set(identities).size !== identities.length) {
    throw new TypeError(`BUILTIN_TEAM_${kind}_PROFILE_ISOLATION_REQUIRED`);
  }
}

export async function buildBuiltinTeamMaterialization(input: BuiltinTeamMaterializationInput) {
  assertDistinctProfileResources(input.model_profile_refs, "MODEL");
  assertDistinctProfileResources(input.context_policy_refs, "CONTEXT_POLICY");
  assertDistinctProfileResources(input.execution_safety_policy_refs, "EXECUTION_SAFETY_POLICY");
  const skillRevisions = await Promise.all(
    BUILTIN_TEAM_SKILLS.map(async (skill) => {
      const packageHash = await sha256ContentHash({
        media_type: "text/markdown",
        body: skill.body,
      });
      return buildSkillRevision({
        schema_version: "skill-revision@1.0.0",
        scope: input.scope,
        skill_id: skill.skill_id,
        revision: skill.revision,
        name: skill.name,
        source_url: `https://builtin.data-agent.invalid/skills/${skill.skill_id}/${skill.revision}`,
        package_hash: packageHash,
        dependency_lock_hash: await sha256ContentHash([]),
        signer_id: BUILTIN_TEAM_SIGNER_ID,
        signature_hash: await sha256ContentHash({
          signer_id: BUILTIN_TEAM_SIGNER_ID,
          package_hash: packageHash,
        }),
        publisher_trust: "TRUSTED_PUBLISHER",
        approval_status: "APPROVED",
        capabilities: [...skill.capabilities].sort(),
        default_resources: [],
        install_scripts: [],
      });
    }),
  );

  const profileIds = DATA_AGENT_SPECIALIST_PROFILE_IDS;
  const profileRevisions: AgentProductProfileRevisionV2[] = [];
  for (const profileId of profileIds) {
    const runtime = getAgentProfileRevision(profileId);
    const profileSkills = skillRevisions
      .filter((revision) =>
        BUILTIN_TEAM_SKILLS.some(
          (definition) =>
            definition.profile_id === profileId && definition.skill_id === revision.skill_id,
        ),
      )
      .map((revision) => ({
        skill_id: revision.skill_id,
        revision: revision.revision,
        revision_hash: revision.revision_hash,
      }))
      .sort((left, right) => left.skill_id.localeCompare(right.skill_id));
    const directTools = [...runtime.direct_tool_allowlist].sort();
    const skillCapabilities = new Set(
      BUILTIN_TEAM_SKILLS.filter(({ profile_id }) => profile_id === profileId).flatMap(
        ({ capabilities }) => capabilities,
      ),
    );
    if ([...skillCapabilities].some((tool) => !directTools.includes(tool))) {
      throw new TypeError("BUILTIN_SKILL_TOOL_NOT_ALLOWED");
    }
    const workflow = BUILTIN_TEAM_WORKFLOWS[profileId];
    profileRevisions.push(
      await buildAgentProductProfileRevisionV2({
        schema_version: "agent-product-profile-revision@2.0.0",
        scope: input.scope,
        profile_id: profileId,
        revision: BUILTIN_PRODUCT_PROFILE_REVISIONS[profileId],
        discovery: {
          schema_version: "subagent-discovery-descriptor@1.0.0",
          ...discovery[profileId],
          produced_artifact_types: [...runtime.expected_output_artifact_types].sort(),
        },
        runtime_profile_ref: {
          profile_id: profileId,
          revision: runtime.revision,
          profile_hash: runtime.profile_hash,
        },
        model_profile_ref: input.model_profile_refs[profileId],
        prompt_ref: {
          prompt_id: `prompt.${profileId}`,
          revision: 2,
          prompt_hash: await sha256ContentHash(prompts[profileId]),
        },
        workflow_ref: {
          workflow_id: `workflow.${profileId}`,
          revision: 2,
          workflow_hash: await sha256ContentHash({ steps: workflow }),
        },
        direct_tool_allowlist: directTools,
        skill_refs: profileSkills,
        context_policy_ref: input.context_policy_refs[profileId],
        execution_safety_policy_ref: input.execution_safety_policy_refs[profileId],
        expected_output_artifact_types: [...runtime.expected_output_artifact_types].sort(),
        verifier_contract_hash: await sha256ContentHash(runtime.verifier),
        approval_status: "APPROVED",
      }),
    );
  }

  return Object.freeze({
    schema_version: "builtin-team-materialization@2.0.0" as const,
    manifest_hash: await sha256ContentHash({
      skill_revision_hashes: skillRevisions.map(({ revision_hash }) => revision_hash),
      profile_revision_hashes: profileRevisions.map(({ revision_hash }) => revision_hash),
      workflow_bytes: canonicalizeJson(BUILTIN_TEAM_WORKFLOWS),
    }),
    skill_revisions: Object.freeze(skillRevisions),
    profile_revisions: Object.freeze(profileRevisions),
  });
}
