import { join } from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: join(import.meta.dirname, "../.."),
  serverExternalPackages: ["pgsql-parser", "libpg-query"],
  transpilePackages: ["@data-agent/contracts", "@data-agent/platform"],
};

export default nextConfig;
