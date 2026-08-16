import { basename, resolve } from "node:path";
import nextEnvironment from "@next/env";

export function resolveRunWorkerRepositoryRoot(cwd: string): string {
  const resolved = resolve(cwd);
  return basename(resolved) === "worker" && basename(resolve(resolved, "..")) === "apps"
    ? resolve(resolved, "../..")
    : resolved;
}

/** Loads root dotenv files and promotes only the supported DeepSeek alias. */
export function loadRunWorkerEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): NodeJS.ProcessEnv {
  if (environment === process.env) {
    nextEnvironment.loadEnvConfig(
      resolveRunWorkerRepositoryRoot(cwd),
      process.env.NODE_ENV !== "production",
    );
  }
  if (!environment.DEEPSEEK_API_KEY?.trim()) {
    const legacy = environment.DeepSeekAPIKey?.trim();
    if (legacy) environment.DEEPSEEK_API_KEY = legacy;
  }
  return environment;
}
