import { describe, expect, it } from "vitest";
import { useDataSourceStore } from "@/lib/datasource-store";
import { useQAStore } from "@/lib/qa-store";
import { useWorkbenchStore } from "@/lib/workbench-store";
import { resetWorkspaceClientState } from "@/lib/workspace-client-state";

describe("workspace client state", () => {
  it("clears workspace-bound stores before a new workspace renders", () => {
    useQAStore.setState({ activeConversationId: "conversation-a", error: "qa-a" });
    useWorkbenchStore.setState({ activeRunId: "run-a", error: "workbench-a" });
    useDataSourceStore.setState({ error: "datasource-a", showForm: true });

    resetWorkspaceClientState();

    expect(useQAStore.getState()).toMatchObject({ activeConversationId: null, error: undefined });
    expect(useWorkbenchStore.getState()).toMatchObject({ activeRunId: null, error: undefined });
    expect(useDataSourceStore.getState()).toMatchObject({ showForm: false, error: undefined });
  });
});
