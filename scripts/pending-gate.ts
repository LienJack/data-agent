import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

const [gate, requiredUnit] = process.argv.slice(2);

if (!gate || !requiredUnit) {
  process.stderr.write("用法：pending-gate <gate> <required-unit>\n");
  process.exit(64);
}

// ---------------------------------------------------------------------------
// Per-gate evidence checks
// ---------------------------------------------------------------------------
interface GateResult {
  gate: string;
  status: string;
  release_decision: string;
  required_unit: string;
  reason_code: string;
  details?: Record<string, unknown>;
}

function checkGate(gate: string, unit: string): GateResult {
  // Base result template
  const base = {
    gate,
    status: "NOT_IMPLEMENTED",
    release_decision: "HOLD",
    required_unit: unit,
    reason_code: "RELEASE_EVIDENCE_INCOMPLETE",
  };

  switch (gate) {
    case "test:e2e": {
      // U8 E2E gate — check if workbench components exist
      const webComponentsExist = existsSync(
        resolve(rootDir, "apps/web/src/components/workbench/workbench-section.tsx"),
      );
      const semanticComponentsExist = existsSync(
        resolve(rootDir, "apps/web/src/components/semantic/review-inbox.tsx"),
      );
      if (webComponentsExist && semanticComponentsExist) {
        return {
          ...base,
          status: "IMPLEMENTED",
          reason_code: "E2E_GATE_READY",
          release_decision: "HOLD", // require real execution
          details: {
            web_components: true,
            semantic_components: true,
            e2e_run: "REQUIRES_LIVE_EXECUTION",
          },
        };
      }
      return {
        ...base,
        reason_code: "U8_WEB_COMPONENTS_MISSING",
        details: {
          web_components: webComponentsExist,
          semantic_components: semanticComponentsExist,
        },
      };
    }

    case "test:deploy:docker": {
      // U9 Docker deploy gate — check compose.yaml and Dockerfiles
      const composeExists = existsSync(resolve(rootDir, "compose.yaml"));
      const dockerWebExists = existsSync(resolve(rootDir, "infra/docker/Dockerfile.web"));
      const dockerWorkerExists = existsSync(resolve(rootDir, "infra/docker/Dockerfile.worker"));
      const initDbExists = existsSync(resolve(rootDir, "infra/docker/init-db.sh"));
      if (composeExists && dockerWebExists && dockerWorkerExists) {
        return {
          ...base,
          status: "IMPLEMENTED",
          reason_code: "DOCKER_DEPLOY_GATE_READY",
          release_decision: "HOLD", // require real execution
          details: {
            compose_exists: composeExists,
            dockerfile_web: dockerWebExists,
            dockerfile_worker: dockerWorkerExists,
            init_db_script: initDbExists,
            docker_run: "REQUIRES_LIVE_EXECUTION",
          },
        };
      }
      return {
        ...base,
        reason_code: "DOCKER_ARTIFACT_MISSING",
        details: {
          compose_exists: composeExists,
          dockerfile_web: dockerWebExists,
          dockerfile_worker: dockerWorkerExists,
          init_db_script: initDbExists,
        },
      };
    }

    case "test:deploy:hosted": {
      // U9 Hosted deploy gate — check migration manifest
      const migrationManifestExists = existsSync(
        resolve(
          rootDir,
          "infra/supabase/apps/data-agent/u9-semantic-migration-maintenance-manifest.json",
        ),
      );
      const platformMigrationExists = existsSync(
        resolve(
          rootDir,
          "infra/supabase/platform/migrations/20260725000100_platform_foundation.sql",
        ),
      );
      if (migrationManifestExists && platformMigrationExists) {
        return {
          ...base,
          status: "IMPLEMENTED",
          reason_code: "HOSTED_DEPLOY_GATE_READY",
          release_decision: "HOLD", // require real execution
          details: {
            migration_manifest: migrationManifestExists,
            platform_migration: platformMigrationExists,
            hosted_run: "REQUIRES_LIVE_EXECUTION",
          },
        };
      }
      return {
        ...base,
        reason_code: "HOSTED_ARTIFACT_MISSING",
        details: {
          migration_manifest: migrationManifestExists,
          platform_migration: platformMigrationExists,
        },
      };
    }

    default:
      return base;
  }
}

const result = checkGate(gate, requiredUnit);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

if (result.release_decision === "HOLD") {
  process.exit(2);
}
