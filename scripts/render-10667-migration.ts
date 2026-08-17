/** Render the reviewed 10667 Agent product profile migration. */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const MIGRATION_NAME = "20260725010667_app_data_agent_agent_product_profiles.sql";
const SOURCE_SEGMENTS = [
  "00-preamble.sql.inc",
  "10-registry.sql.inc",
  "20-registry-rpcs.sql.inc",
  "30-command-routing.sql.inc",
  "40-team-trace.sql.inc",
  "50-public-sse.sql.inc",
  "90-grants.sql.inc",
  "99-ledger.sql.inc",
] as const;
const PLACEHOLDER = "__U20_AGENT_PROFILE_MIGRATION_CHECKSUM__";
const QUEUE_PLACEHOLDER = "__U20_QUEUE_FUNCTION_OVERRIDES__";
const PUBLIC_SSE_PLACEHOLDER = "__U20_PUBLIC_SSE_FUNCTION_OVERRIDES__";
const ZERO = `sha256:${"0".repeat(64)}`;
const digest = (value: string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const normalize = (value: string) => `${value.replace(/\r\n?/g, "\n").replace(/\n+$/g, "")}\n`;
const root = resolve(import.meta.dirname, "..");
const appRoot = resolve(root, "infra/supabase/apps/data-agent");
const sourceRoot = resolve(appRoot, "migration-sources/10667");
const output = resolve(appRoot, "migrations", MIGRATION_NAME);
if (!existsSync(sourceRoot)) throw new Error("10667 source missing");
const actual = readdirSync(sourceRoot)
  .filter((entry) => entry.endsWith(".sql.inc"))
  .sort();
if (JSON.stringify(actual) !== JSON.stringify([...SOURCE_SEGMENTS].sort())) {
  throw new Error(`10667 segment closure mismatch: ${actual.join(",")}`);
}
const sourceBody = SOURCE_SEGMENTS.map((segment) =>
  normalize(readFileSync(resolve(sourceRoot, segment), "utf8")),
).join("");
const queueMigration = readFileSync(
  resolve(appRoot, "migrations", "20260725010520_app_data_agent_runtime_queue_lease.sql"),
  "utf8",
);
const queueStart = queueMigration.indexOf(
  "create or replace function app_data_agent.claim_run_work(",
);
const queueEnd = queueMigration.lastIndexOf("commit;");
if (queueStart < 0 || queueEnd <= queueStart) throw new Error("10667 queue source boundary drift");
const queueSource = queueMigration.slice(queueStart, queueEnd);
const legacyPair = /'START_L2_RESEARCH',\s*'RESUME_RUN'/g;
if ([...queueSource.matchAll(legacyPair)].length !== 4) {
  throw new Error("10667 queue allowlist occurrence drift");
}
const queueFunctions = queueSource.replaceAll(
  legacyPair,
  "'START_DATA_AGENT_TEAM',\n          'START_L2_RESEARCH',\n          'RESUME_RUN'",
);
const foundationMigration = readFileSync(
  resolve(appRoot, "migrations", "20260725010500_app_data_agent_runtime_foundation.sql"),
  "utf8",
);
const settlementMigration = readFileSync(
  resolve(appRoot, "migrations", "20260725010530_app_data_agent_runtime_event_settlement.sql"),
  "utf8",
);
function extractReviewedFunction(source: string, signature: string, following: string): string {
  const start = source.indexOf(signature);
  const end = source.indexOf(following, start);
  if (start < 0 || end <= start)
    throw new Error(`10667 reviewed function boundary drift: ${signature}`);
  return normalize(source.slice(start, end));
}
const displayEventTypes = [
  "run.progress",
  "run.tool_started",
  "run.tool_completed",
  "run.tool_failed",
  "run.answer_delta",
  "run.reasoning_started",
  "run.reasoning_delta",
  "run.reasoning_completed",
] as const;
const quotedDisplayEventTypes = displayEventTypes
  .map((eventType) => `'${eventType}'`)
  .join(",\n    ");
const reducerAnchor = "    when 'run.suspended' then";
const prepareAllowlistAnchor = "    'run.side_effect_committed',\n    'run.suspended',";
const appendAllowlistAnchor = "      'run.side_effect_committed',\n      'run.suspended',";
const appendCaseAnchor = "    when 'run.suspended' then\n      required_status := 'WAITING';";
const prepareValidationAnchor = "  if new.event_type not in (";
let reducerFunction = extractReviewedFunction(
  foundationMigration,
  "create or replace function app_data_agent.reduce_run_projection_document(",
  "\n\ncreate table app_data_agent.run_attempts",
);
if (reducerFunction.split(reducerAnchor).length - 1 !== 1) {
  throw new Error("10667 reducer display branch anchor drift");
}
reducerFunction = reducerFunction.replace(
  reducerAnchor,
  `${displayEventTypes.map((eventType) => `    when '${eventType}' then null;`).join("\n")}\n${reducerAnchor}`,
);
let prepareFunction = extractReviewedFunction(
  foundationMigration,
  "create or replace function app_data_agent.prepare_run_event_insert()",
  "\n\ncreate trigger run_event_prepare",
);
if (prepareFunction.split(prepareAllowlistAnchor).length - 1 !== 1) {
  throw new Error("10667 prepare display allowlist anchor drift");
}
prepareFunction = prepareFunction.replace(
  prepareAllowlistAnchor,
  `    'run.side_effect_committed',\n    ${quotedDisplayEventTypes},\n    'run.suspended',`,
);
if (prepareFunction.split(prepareValidationAnchor).length - 1 !== 1) {
  throw new Error("10667 prepare display validation anchor drift");
}
prepareFunction = prepareFunction.replace(
  prepareValidationAnchor,
  `  if new.event_type in (${quotedDisplayEventTypes.replaceAll("\n    ", "\n      ")})\n    and not app_data_agent.public_run_display_payload_is_valid(\n      new.event_type,\n      new.payload_json\n    )\n  then\n    raise exception using\n      errcode = '22023',\n      message = 'DA_RUN_DISPLAY_EVENT_PAYLOAD_INVALID';\n  end if;\n\n${prepareValidationAnchor}`,
);
let appendFunction = extractReviewedFunction(
  settlementMigration,
  "create or replace function app_data_agent.append_run_event(",
  "\n\ncommit;",
);
if (appendFunction.split(appendAllowlistAnchor).length - 1 !== 1) {
  throw new Error("10667 append display allowlist anchor drift");
}
appendFunction = appendFunction.replace(
  appendAllowlistAnchor,
  `      'run.side_effect_committed',\n      ${quotedDisplayEventTypes.replaceAll("\n", "\n      ")},\n      'run.suspended',`,
);
if (appendFunction.split(appendCaseAnchor).length - 1 !== 1) {
  throw new Error("10667 append display transition anchor drift");
}
appendFunction = appendFunction.replace(
  appendCaseAnchor,
  `    when ${quotedDisplayEventTypes.replaceAll("\n    ", "\n      ")} then\n      required_status := 'RUNNING';\n${appendCaseAnchor}`,
);
const publicSseFunctions = normalize(`${reducerFunction}${prepareFunction}${appendFunction}`);
if (sourceBody.split(QUEUE_PLACEHOLDER).length - 1 !== 1) {
  throw new Error("10667 queue placeholder mismatch");
}
if (sourceBody.split(PUBLIC_SSE_PLACEHOLDER).length - 1 !== 1) {
  throw new Error("10667 public SSE placeholder mismatch");
}
const body = sourceBody
  .replace(QUEUE_PLACEHOLDER, () => normalize(queueFunctions))
  .replace(PUBLIC_SSE_PLACEHOLDER, () => publicSseFunctions);
if (body.split(PLACEHOLDER).length - 1 !== 1) throw new Error("10667 placeholder mismatch");
const checksum = digest(
  `-- u20_agent_profile_migration_checksum: ${ZERO}\n${body.replaceAll(PLACEHOLDER, ZERO)}`,
);
const content = `-- u20_agent_profile_migration_checksum: ${checksum}\n${body.replaceAll(PLACEHOLDER, checksum)}`;
if (content.split(checksum).length - 1 !== 2) throw new Error("10667 checksum count mismatch");
if (process.argv.includes("--verify")) {
  if (!existsSync(output) || readFileSync(output, "utf8") !== content) {
    throw new Error("10667 migration does not match source");
  }
  console.log(`10667 migration verified: ${basename(output)} checksum=${checksum}`);
} else {
  writeFileSync(output, content);
  console.log(`10667 migration written: ${output}`);
  console.log(`checksum: ${checksum}`);
}
