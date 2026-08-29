import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildNasRemoteComposeCommand,
  buildNasRsyncArgs,
  buildNasSshTunnelArgs,
  resolveNasRuntimeConfig,
} from "../scripts/nas-runtime.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

interface NasComposeConfig {
  readonly services: {
    readonly neo4j: {
      readonly ports: readonly { host_ip: string; published: string; target: number }[];
    };
    readonly postgres: {
      readonly ports: readonly { host_ip: string; published: string; target: number }[];
    };
    readonly web: {
      readonly ports: readonly { host_ip: string; published: string; target: number }[];
    };
  };
}

function nasComposeConfig(): NasComposeConfig {
  return JSON.parse(
    execFileSync(
      "docker",
      [
        "compose",
        "-f",
        "compose.yaml",
        "-f",
        "compose.nas.yaml",
        "--profile",
        "deploy",
        "config",
        "--format",
        "json",
      ],
      { cwd: repositoryRoot, encoding: "utf8" },
    ),
  ) as NasComposeConfig;
}

describe("NAS runtime contract", () => {
  it("使用非秘密默认值并拒绝 shell 注入形态", () => {
    expect(resolveNasRuntimeConfig({})).toMatchObject({
      sshHost: "data-agent-nas",
      projectDir: "/vol1/1000/work/data-agent/current",
      postgresForwardPort: 55432,
      neo4jHttpForwardPort: 7474,
      neo4jBoltForwardPort: 7687,
      webUrl: "http://192.168.5.41:3001",
    });
    expect(() => resolveNasRuntimeConfig({ DATA_AGENT_NAS_SSH_HOST: "nas; id" })).toThrowError(
      "NAS_SSH_HOST_INVALID",
    );
    expect(() =>
      resolveNasRuntimeConfig({ DATA_AGENT_NAS_PROJECT_DIR: "relative/path" }),
    ).toThrowError("NAS_PROJECT_DIR_INVALID");
    expect(() =>
      resolveNasRuntimeConfig({ DATA_AGENT_NAS_POSTGRES_FORWARD_PORT: "70000" }),
    ).toThrowError("NAS_FORWARD_PORT_INVALID:postgres");
  });

  it("SSH tunnel 只转发三个 loopback 端口并启用失败关闭", () => {
    const args = buildNasSshTunnelArgs(resolveNasRuntimeConfig({}));
    expect(args).toEqual([
      "-N",
      "-o",
      "BatchMode=yes",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      "-L",
      "55432:127.0.0.1:55432",
      "-L",
      "7474:127.0.0.1:7474",
      "-L",
      "7687:127.0.0.1:7687",
      "data-agent-nas",
    ]);
  });

  it("远端 Compose 命令固定工作目录、override 与可审计 provenance", () => {
    const command = buildNasRemoteComposeCommand(
      resolveNasRuntimeConfig({}),
      ["--profile", "deploy", "up", "--build", "-d", "--wait"],
      { DATA_AGENT_GIT_COMMIT: "abc1234", DATA_AGENT_GIT_DIRTY: "false" },
    );
    expect(command).toContain("cd '/vol1/1000/work/data-agent/current'");
    expect(command).toContain("env 'DATA_AGENT_GIT_COMMIT=abc1234' 'DATA_AGENT_GIT_DIRTY=false'");
    expect(command).toContain(
      "docker compose -f 'compose.yaml' -f 'compose.nas.yaml' '--profile' 'deploy' 'up' '--build' '-d' '--wait'",
    );
    expect(command).not.toMatch(/password|private.?key|keychain/i);
  });

  it("源码同步限定 NAS deployment mirror 并保护 Secret 与运行产物", () => {
    const args = buildNasRsyncArgs(resolveNasRuntimeConfig({}), repositoryRoot);
    expect(args).toContain("--delete");
    expect(args).toContain("--exclude=.env");
    expect(args).toContain("--exclude=.env.local");
    expect(args).toContain("--exclude=.git/");
    expect(args.at(-1)).toBe("data-agent-nas:/vol1/1000/work/data-agent/current/");
  });

  it("NAS Compose 只把数据库暴露在远端 loopback，Web 使用 3001", () => {
    const config = nasComposeConfig();
    expect(config.services.postgres.ports).toHaveLength(1);
    expect(config.services.postgres.ports[0]).toMatchObject({
      host_ip: "127.0.0.1",
      published: "55432",
      target: 5432,
    });
    expect(config.services.neo4j.ports).toHaveLength(2);
    expect(config.services.neo4j.ports).toMatchObject([
      { host_ip: "127.0.0.1", published: "7474", target: 7474 },
      { host_ip: "127.0.0.1", published: "7687", target: 7687 },
    ]);
    expect(config.services.web.ports).toHaveLength(1);
    expect(config.services.web.ports[0]).toMatchObject({
      host_ip: "192.168.5.41",
      published: "3001",
      target: 3000,
    });
    expect(config.services).not.toHaveProperty("python-sandbox");
  });
});
