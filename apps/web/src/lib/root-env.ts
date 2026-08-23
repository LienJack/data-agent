import "server-only";

import {
  loadRuntimeEnvironment,
  normalizeRuntimeEnvironment,
} from "@data-agent/platform/runtime-config";

const ROOT_ENV_STATE = Symbol.for("data-agent.root-env-state");

interface RootEnvState {
  loaded: boolean;
}

function state(): RootEnvState {
  const globals = globalThis as typeof globalThis & {
    [ROOT_ENV_STATE]?: RootEnvState;
  };
  globals[ROOT_ENV_STATE] ??= { loaded: false };
  return globals[ROOT_ENV_STATE];
}

/** Loads repository-root dotenv once; process injection remains authoritative. */
export function ensureRootEnvironmentLoaded(): void {
  const current = state();
  if (current.loaded) {
    normalizeRuntimeEnvironment(process.env);
    return;
  }
  loadRuntimeEnvironment();
  current.loaded = true;
}
