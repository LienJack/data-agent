import "server-only";

import { basename, resolve } from "node:path";
import nextEnvironment from "@next/env";

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

function resolveRepositoryRoot(): string {
  const cwd = resolve(process.cwd());
  return basename(cwd) === "web" && basename(resolve(cwd, "..")) === "apps"
    ? resolve(cwd, "../..")
    : cwd;
}

function promoteAlias(standardName: string, aliasName: string): void {
  if (process.env[standardName]?.trim()) return;
  const aliasValue = process.env[aliasName]?.trim();
  if (aliasValue) process.env[standardName] = aliasValue;
}

/**
 * Load the repository-root .env once and normalize legacy local key names.
 * Existing process variables always win, which keeps container/host injection authoritative.
 */
export function ensureRootEnvironmentLoaded(): void {
  const current = state();
  if (!current.loaded) {
    nextEnvironment.loadEnvConfig(resolveRepositoryRoot(), process.env.NODE_ENV !== "production");
    current.loaded = true;
  }

  promoteAlias("DEEPSEEK_API_KEY", "DeepSeekAPIKey");
  promoteAlias("MOONSHOT_API_KEY", "KimiAPIKey");
}
