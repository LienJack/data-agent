import {
  DELEGATE_TO_SUBAGENT_TOOL_NAME,
  delegateToSubagentArgumentsSchema,
} from "@data-agent/contracts";
import type { ServerOwnedToolDescriptor } from "../tools/registry.js";

export const SUBAGENT_DELEGATION_TOOL_DESCRIPTOR = Object.freeze({
  tool_name: DELEGATE_TO_SUBAGENT_TOOL_NAME,
  description:
    "Delegate one governed objective to an eligible Subagent from the frozen capability catalog. Use only when direct answering cannot satisfy the evidence contract.",
  input_schema: delegateToSubagentArgumentsSchema,
  network_access: { mode: "DENY" },
} satisfies ServerOwnedToolDescriptor);

export const ROOT_AGENT_TOOL_ALLOWLIST = Object.freeze([DELEGATE_TO_SUBAGENT_TOOL_NAME] as const);
