import { basename, resolve } from "node:path";
import nextEnvironment from "@next/env";

export const RUNTIME_ENVIRONMENT_ALIASES = Object.freeze({
  DEEPSEEK_API_KEY: ["DeepSeekAPIKey"],
  MOONSHOT_API_KEY: ["MoonshotAPIKey", "KimiAPIKey"],
  ZAI_API_KEY: ["GLMAPIKey"],
} as const);

export interface RuntimeEnvironmentAliasDiagnostic {
  readonly alias_name: string;
  readonly canonical_name: keyof typeof RUNTIME_ENVIRONMENT_ALIASES;
  readonly reason_code: "RUNTIME_ENV_ALIAS_PROMOTED";
}

export interface RuntimeEnvironmentNormalization {
  readonly diagnostics: readonly RuntimeEnvironmentAliasDiagnostic[];
  readonly environment: NodeJS.ProcessEnv;
}

export interface RuntimeEnvironmentLoadResult extends RuntimeEnvironmentNormalization {
  readonly dotenv_loaded: boolean;
  readonly repository_root: string;
}

export type RuntimeDotenvLoader = (directory: string, development: boolean) => unknown;

export interface LoadRuntimeEnvironmentOptions {
  readonly cwd?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly load_dotenv?: boolean;
  readonly loadEnvConfig?: RuntimeDotenvLoader;
  readonly onDiagnostic?: (diagnostic: RuntimeEnvironmentAliasDiagnostic) => void;
}

const loadedEnvironmentRoots = new WeakMap<NodeJS.ProcessEnv, Set<string>>();

export function resolveRuntimeRepositoryRoot(cwd: string): string {
  const resolved = resolve(cwd);
  const applicationDirectory = basename(resolved);
  const parent = resolve(resolved, "..");
  return (applicationDirectory === "web" || applicationDirectory === "worker") &&
    basename(parent) === "apps"
    ? resolve(parent, "..")
    : resolved;
}

export function normalizeRuntimeEnvironment(
  environment: NodeJS.ProcessEnv,
  onDiagnostic?: (diagnostic: RuntimeEnvironmentAliasDiagnostic) => void,
): RuntimeEnvironmentNormalization {
  const diagnostics: RuntimeEnvironmentAliasDiagnostic[] = [];
  for (const [canonicalName, aliasNames] of Object.entries(RUNTIME_ENVIRONMENT_ALIASES) as Array<
    [keyof typeof RUNTIME_ENVIRONMENT_ALIASES, readonly string[]]
  >) {
    if (environment[canonicalName]?.trim()) continue;
    const aliasName = aliasNames.find((candidate) => environment[candidate]?.trim());
    if (!aliasName) continue;
    environment[canonicalName] = environment[aliasName]?.trim();
    const diagnostic = Object.freeze({
      alias_name: aliasName,
      canonical_name: canonicalName,
      reason_code: "RUNTIME_ENV_ALIAS_PROMOTED" as const,
    });
    diagnostics.push(diagnostic);
    onDiagnostic?.(diagnostic);
  }
  return { diagnostics: Object.freeze(diagnostics), environment };
}

export function loadRuntimeEnvironment(
  options: LoadRuntimeEnvironmentOptions = {},
): RuntimeEnvironmentLoadResult {
  const environment = options.environment ?? process.env;
  const repositoryRoot = resolveRuntimeRepositoryRoot(options.cwd ?? process.cwd());
  const shouldLoadDotenv = options.load_dotenv ?? environment === process.env;
  let dotenvLoaded = false;

  if (shouldLoadDotenv) {
    const development = environment.NODE_ENV !== "production";
    const stateKey = `${repositoryRoot}\u0000${development ? "development" : "production"}`;
    const loadedRoots = loadedEnvironmentRoots.get(environment) ?? new Set<string>();
    if (!loadedRoots.has(stateKey)) {
      const loader = options.loadEnvConfig ?? nextEnvironment.loadEnvConfig;
      loader(repositoryRoot, development);
      loadedRoots.add(stateKey);
      loadedEnvironmentRoots.set(environment, loadedRoots);
      dotenvLoaded = true;
    }
  }

  const normalized = normalizeRuntimeEnvironment(environment, options.onDiagnostic);
  return {
    ...normalized,
    dotenv_loaded: dotenvLoaded,
    repository_root: repositoryRoot,
  };
}
