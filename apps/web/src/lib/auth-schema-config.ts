import pg from "pg";
import { createDataAgentAuth } from "./auth-config";

const connectionString = process.env.AUTH_DATABASE_URL ?? process.env.DATABASE_URL;
const secret = process.env.BETTER_AUTH_SECRET;
if (!connectionString || !secret || secret.length < 32) {
  throw new Error(
    "Better Auth schema generation requires DATABASE_URL/AUTH_DATABASE_URL and BETTER_AUTH_SECRET.",
  );
}

/** CLI-only reviewed schema source. Runtime code imports getDataAgentAuth(), not this instance. */
export const auth = createDataAgentAuth({
  pool: new pg.Pool({
    connectionString,
    options: "-c search_path=data_agent_auth,pg_catalog",
  }),
  secret,
  ...(process.env.BETTER_AUTH_URL ? { baseURL: process.env.BETTER_AUTH_URL } : {}),
});
