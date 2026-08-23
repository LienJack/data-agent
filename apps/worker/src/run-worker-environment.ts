import {
  loadRuntimeEnvironment,
  resolveRuntimeRepositoryRoot,
} from "@data-agent/platform/runtime-config";

export const resolveRunWorkerRepositoryRoot = resolveRuntimeRepositoryRoot;

export function loadRunWorkerEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): NodeJS.ProcessEnv {
  return loadRuntimeEnvironment({ cwd, environment }).environment;
}
