import "server-only";

import type { DataSourceCredentialRef } from "@data-agent/contracts";
import type { DatabaseType, SSLOption } from "./datasource-types";

export interface StoredDataSourceConnection {
  id: string;
  name: string;
  type: DatabaseType;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  credentialRef?: DataSourceCredentialRef;
  ssl?: SSLOption;
  path?: string;
  catalog?: string;
  schema?: string;
  status: "active" | "error" | "unknown";
  lastTestedAt?: string;
  createdAt: string;
  updatedAt: string;
}

const globalStore = globalThis as unknown as {
  __datasourceCredentialRefConnections?: Map<string, StoredDataSourceConnection>;
};

if (!globalStore.__datasourceCredentialRefConnections) {
  globalStore.__datasourceCredentialRefConnections = new Map();
}

export const dataSourceConnections = globalStore.__datasourceCredentialRefConnections;
