// Run from the repository root. This serves a focus-only React regression fixture;
// it never launches a browser, accesses a database, or calls a model.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const rootRequire = createRequire(resolve(root, "package.json"));
// Reuse the installed tsx toolchain, without adding a production dependency.
const { build } = createRequire(rootRequire.resolve("tsx/cli"))("esbuild");
const webRequire = createRequire(resolve(root, "apps/web/package.json"));
const inertLeaves = {
  "node:crypto": 'export default new Proxy({}, { get() { throw new Error("CRYPTO_OUT_OF_SCOPE"); } });',
  "next/navigation": "export const useParams = () => ({});",
  "@/components/qa/agent-team-trace": "export const AgentTeamTrace = () => null;",
  "@/components/workbench/artifact-preview-panel": "export const ArtifactPreviewPanel = () => null;",
  "@/lib/api-client": `
    export class ApiRequestError extends Error {}
    const unexpected = () => { throw new Error("NETWORK_OUT_OF_SCOPE"); };
    export const fetchAgentProfiles = unexpected, fetchAgentTeamTrace = unexpected,
      fetchResolutionTrace = unexpected, fetchResolutionTraceDetail = unexpected,
      fetchSqlHistory = unexpected;
  `,
  "@/lib/qa-store": `
    export const useQAStore = selector => selector({ openConversation: () => {} }),
      useQAActiveConversationId = () => null, useQAConnection = () => null,
      useQAEvents = () => [], useQATrajectoryFocus = () => null;
  `,
};
const output = await build({
  entryPoints: [resolve(root, "apps/web/test-support/resolution-trace-focus-fixture.tsx")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  tsconfig: resolve(root, "apps/web/tsconfig.json"),
  define: { "process.env.NODE_ENV": '"development"' },
  alias: {
    react: dirname(webRequire.resolve("react")),
    "react-dom": dirname(webRequire.resolve("react-dom")),
  },
  plugins: [{
    name: "focus-only-leaves",
    setup(api) {
      api.onResolve({ filter: /.*/ }, args =>
        Object.hasOwn(inertLeaves, args.path) ? { path: args.path, namespace: "stub" } : undefined,
      );
      api.onLoad({ filter: /.*/, namespace: "stub" }, args => ({
        contents: inertLeaves[args.path],
        loader: "js",
      }));
    },
  }],
});
const server = createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (request.url === "/bundle.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(output.outputFiles[0].contents);
  } else {
    response.setHeader("Content-Type", "text/html");
    response.end('<div id="root"></div><script src="/bundle.js"></script>');
  }
});
server.listen(3311, "127.0.0.1", () => console.log("FOCUS_PROBE_READY:3311"));
process.on("SIGTERM", () => server.close());
