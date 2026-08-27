import { DELEGATE_TO_SUBAGENT_TOOL_NAME } from "@data-agent/contracts";
import type { ServerOwnedToolDescriptor } from "../tools/registry.js";
import { rootAgentDelegationToolArgumentsSchema } from "./root-agent-harness.js";

export const SUBAGENT_DELEGATION_TOOL_DESCRIPTOR = Object.freeze({
  tool_name: DELEGATE_TO_SUBAGENT_TOOL_NAME,
  description:
    "Delegate the current next governed objective to an eligible Subagent from the frozen capability catalog. Supply only already accepted Artifacts through input_artifact_refs. Multiple calls in one turn must be independent.",
  input_schema: rootAgentDelegationToolArgumentsSchema,
  network_access: { mode: "DENY" },
} satisfies ServerOwnedToolDescriptor);

export const ROOT_AGENT_TOOL_ALLOWLIST = Object.freeze([DELEGATE_TO_SUBAGENT_TOOL_NAME] as const);
