/** Render the reviewed 10671 public Agent/Tool/Artifact event migration. */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const MIGRATION_NAME = "20260725010671_app_data_agent_public_agent_events.sql";
const SOURCE_SEGMENTS = [
  "00-preamble.sql.inc",
  "10-public-agent-event-contract.sql.inc",
  "99-ledger.sql.inc",
] as const;
const CHECKSUM_PLACEHOLDER = "__PUBLIC_AGENT_EVENT_MIGRATION_CHECKSUM__";
const FUNCTIONS_PLACEHOLDER = "__PUBLIC_AGENT_EVENT_FUNCTION_OVERRIDES__";
const ZERO = `sha256:${"0".repeat(64)}`;
const digest = (value: string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const normalize = (value: string) => `${value.replace(/\r\n?/g, "\n").replace(/\n+$/g, "")}\n`;
const root = resolve(import.meta.dirname, "..");
const appRoot = resolve(root, "infra/supabase/apps/data-agent");
const sourceRoot = resolve(appRoot, "migration-sources/10671");
const output = resolve(appRoot, "migrations", MIGRATION_NAME);
const previous = readFileSync(
  resolve(appRoot, "migrations", "20260725010667_app_data_agent_agent_product_profiles.sql"),
  "utf8",
);
if (!existsSync(sourceRoot)) throw new Error("10671 source missing");
const actual = readdirSync(sourceRoot)
  .filter((entry) => entry.endsWith(".sql.inc"))
  .sort();
if (JSON.stringify(actual) !== JSON.stringify([...SOURCE_SEGMENTS].sort()))
  throw new Error(`10671 segment closure mismatch: ${actual.join(",")}`);

function extractFunction(signature: string, following: string): string {
  const start = previous.indexOf(signature);
  const end = previous.indexOf(following, start);
  if (start < 0 || end <= start) throw new Error(`10671 function boundary drift: ${signature}`);
  return normalize(previous.slice(start, end));
}
function replaceOnce(source: string, anchor: string, replacement: string): string {
  if (source.split(anchor).length - 1 !== 1)
    throw new Error(`10671 anchor drift: ${anchor.slice(0, 80)}`);
  return source.replace(anchor, replacement);
}

let reducer = extractFunction(
  "create or replace function app_data_agent.reduce_run_projection_document(",
  "\ncreate or replace function app_data_agent.prepare_run_event_insert()",
);
reducer = replaceOnce(
  reducer,
  "    when 'run.suspended' then",
  "    when 'run.agent_status' then null;\n    when 'run.suspended' then",
);

let prepare = extractFunction(
  "create or replace function app_data_agent.prepare_run_event_insert()",
  "\ncreate or replace function app_data_agent.append_run_event(",
);
prepare = replaceOnce(
  prepare,
  "    'schema_version',\n    '1.0.0',",
  "    'schema_version',\n    coalesce(new.event_document ->> 'schema_version','1.0.0'),",
);
prepare = replaceOnce(
  prepare,
  "  if new.event_type in ('run.progress',",
  "  if coalesce(new.event_document->>'schema_version','1.0.0')='1.0.0'\n    and new.event_type in ('run.progress',",
);
prepare = replaceOnce(
  prepare,
  "    'run.reasoning_completed',\n    'run.suspended',",
  "    'run.reasoning_completed',\n    'run.agent_status',\n    'run.suspended',",
);
prepare = replaceOnce(
  prepare,
  "  if new.event_type not in (",
  "  if coalesce(new.event_document->>'schema_version','1.0.0') not in ('1.0.0','run-runtime-event@2.0.0')\n    or (coalesce(new.event_document->>'schema_version','1.0.0')='run-runtime-event@2.0.0'\n      and new.event_type not in ('run.tool_started','run.tool_completed','run.tool_failed','run.agent_status'))\n  then raise exception using errcode='22023',message='DA_RUN_EVENT_SCHEMA_VERSION_INVALID'; end if;\n\n  if new.event_type not in (",
);

let append = extractFunction(
  "create or replace function app_data_agent.append_run_event(",
  "\ncreate or replace function app_data_agent.complete_run_work(",
);
append = replaceOnce(
  append,
  "  if requested_event ->> 'schema_version' <> '1.0.0'\n    or requested_projection ->> 'schema_version' <> '1.0.0'",
  "  if requested_event ->> 'schema_version' not in ('1.0.0','run-runtime-event@2.0.0')\n    or (requested_event ->> 'schema_version'='run-runtime-event@2.0.0'\n      and requested_event ->> 'event_type' not in ('run.tool_started','run.tool_completed','run.tool_failed','run.agent_status'))\n    or requested_projection ->> 'schema_version' <> '1.0.0'",
);
append = replaceOnce(
  append,
  "          'run.reasoning_completed',\n      'run.suspended',",
  "          'run.reasoning_completed',\n          'run.agent_status',\n      'run.suspended',",
);
append = replaceOnce(
  append,
  "      'run.reasoning_completed' then\n      required_status := 'RUNNING';",
  "      'run.reasoning_completed',\n      'run.agent_status' then\n      required_status := 'RUNNING';",
);

const functions = normalize(`${reducer}${prepare}${append}`);
let body = SOURCE_SEGMENTS.map((segment) =>
  normalize(readFileSync(resolve(sourceRoot, segment), "utf8")),
).join("");
if (body.split(FUNCTIONS_PLACEHOLDER).length - 1 !== 1)
  throw new Error("10671 functions placeholder mismatch");
body = body.replace(FUNCTIONS_PLACEHOLDER, () => functions);
if (body.split(CHECKSUM_PLACEHOLDER).length - 1 !== 1)
  throw new Error("10671 checksum placeholder mismatch");
const checksum = digest(
  `-- public_agent_event_migration_checksum: ${ZERO}\n${body.replace(CHECKSUM_PLACEHOLDER, ZERO)}`,
);
const content = `-- public_agent_event_migration_checksum: ${checksum}\n${body.replace(CHECKSUM_PLACEHOLDER, checksum)}`;
if (content.split(checksum).length - 1 !== 2) throw new Error("10671 checksum count mismatch");
if (process.argv.includes("--verify")) {
  if (!existsSync(output) || readFileSync(output, "utf8") !== content)
    throw new Error("10671 migration does not match source");
  console.log(`10671 migration verified: ${basename(output)} checksum=${checksum}`);
} else {
  writeFileSync(output, content);
  console.log(`10671 migration written: ${output}`);
  console.log(`checksum: ${checksum}`);
}
