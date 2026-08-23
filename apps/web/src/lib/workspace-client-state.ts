import { useDataSourceStore } from "./datasource-store";
import { useQAStore } from "./qa-store";
import { useWorkbenchStore } from "./workbench-store";

export function resetWorkspaceClientState(): void {
  useQAStore.getState().reset();
  useWorkbenchStore.getState().reset();
  useDataSourceStore.getState().reset();
}
