import { buildFalcon24SemanticChangeSet } from "../apps/worker/src/evals/falcon24-semantic-change-set.js";

function argument(name: string): string {
  const direct = process.argv.find((value) => value.startsWith(`--${name}=`));
  const value = direct?.slice(name.length + 3);
  if (!value) throw new TypeError("FALCON24_E1_SEMANTIC_CHANGE_SET_INPUT_REQUIRED");
  return value;
}

const input = JSON.parse(Buffer.from(argument("input"), "base64url").toString("utf8")) as {
  readonly scope: {
    readonly app_id: string;
    readonly tenant_id: string;
    readonly environment: string;
    readonly semantic_domain: "falcon24";
  };
  readonly base_release: {
    readonly release_id: string;
    readonly generation: number;
    readonly release_hash: `sha256:${string}`;
  };
  readonly revision: number;
};

const prepared = await buildFalcon24SemanticChangeSet(input);
process.stdout.write(JSON.stringify(prepared));
