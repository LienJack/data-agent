import { join } from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: join(import.meta.dirname, "../.."),
  serverExternalPackages: ["pgsql-parser", "libpg-query"],
  transpilePackages: ["@data-agent/contracts", "@data-agent/platform"],
  async redirects() {
    return [
      { source: "/", destination: "/workspaces", permanent: false },
      { source: "/qa", destination: "/workspaces", permanent: false },
      { source: "/tests", destination: "/workspaces", permanent: false },
      { source: "/data-sources", destination: "/workspaces", permanent: false },
      { source: "/settings", destination: "/workspaces", permanent: false },
    ];
  },
};

export default nextConfig;
