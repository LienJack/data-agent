import "server-only";

import pg from "pg";
import { createDataAgentAuth, type DataAgentAuth } from "./auth-config";
import { ensureRootEnvironmentLoaded } from "./root-env";

const AUTH_RUNTIME = Symbol.for("data-agent.auth-runtime");

interface AuthRuntimeState {
  pool?: pg.Pool;
  auth?: DataAgentAuth;
}

function runtimeState(): AuthRuntimeState {
  const globals = globalThis as typeof globalThis & { [AUTH_RUNTIME]?: AuthRuntimeState };
  globals[AUTH_RUNTIME] ??= {};
  return globals[AUTH_RUNTIME];
}

export class DataAgentAuthConfigurationError extends Error {
  override readonly name = "DataAgentAuthConfigurationError";
  readonly code = "AUTH_RUNTIME_NOT_CONFIGURED";
}

function requireRuntimeConfiguration() {
  ensureRootEnvironmentLoaded();
  const connectionString = process.env.AUTH_DATABASE_URL ?? process.env.DATABASE_URL;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!connectionString || !secret || secret.length < 32) {
    throw new DataAgentAuthConfigurationError(
      "身份运行时需要 DATABASE_URL/AUTH_DATABASE_URL 和至少 32 字符的 BETTER_AUTH_SECRET。",
    );
  }
  return {
    connectionString,
    secret,
    baseURL: process.env.BETTER_AUTH_URL,
  };
}

export function getDataAgentAuth(): DataAgentAuth {
  const state = runtimeState();
  if (state.auth) return state.auth;
  const config = requireRuntimeConfiguration();
  state.pool ??= new pg.Pool({
    connectionString: config.connectionString,
    options: "-c search_path=data_agent_auth,pg_catalog",
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
    idle_in_transaction_session_timeout: 30_000,
  });
  state.auth = createDataAgentAuth({
    pool: state.pool,
    secret: config.secret,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  });
  return state.auth;
}

export function getDataAgentAuthPool(): pg.Pool {
  getDataAgentAuth();
  const pool = runtimeState().pool;
  if (!pool) throw new DataAgentAuthConfigurationError("身份数据库连接池未初始化。");
  return pool;
}
