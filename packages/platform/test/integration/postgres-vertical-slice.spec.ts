import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createPostgresDatasourceEgress } from "../../src/datasources/postgres-datasource-egress.js";
import { createPostgresOutbox } from "../../src/outbox/postgres-outbox.js";
import { createPostgresRepository } from "../../src/persistence/repository.js";
import { adaptPgPool, withAppTransaction } from "../../src/persistence/transaction.js";
import { createPostgresSecretRefRepository } from "../../src/secrets/postgres-secret-ref.js";
import { createPostgresCapabilityAuthority } from "../../src/tenancy/postgres-authority.js";

const APP_ID = "00000000-0000-4000-8000-00000000da01";
const DEPLOYMENT_ID = "00000000-0000-4000-8000-00000000de01";
const TENANT_ONE = "00000000-0000-4000-8000-00000000aa11";
const TENANT_TWO = "00000000-0000-4000-8000-00000000aa22";
const OWNER_ONE = "00000000-0000-4000-8000-000000001001";
const OWNER_TWO = "00000000-0000-4000-8000-000000001003";

const databaseUrl = process.env.DATA_AGENT_TEST_DATABASE_URL;
const adminDatabaseUrl = process.env.DATA_AGENT_TEST_ADMIN_DATABASE_URL;

describe.skipIf(!databaseUrl || !adminDatabaseUrl)(
  "PostgreSQL authority + repository + outbox vertical slice",
  () => {
    const backendPool = new Pool({ connectionString: databaseUrl });
    const adminPool = new Pool({ connectionString: adminDatabaseUrl });
    const sqlPool = adaptPgPool(backendPool);
    const authorityOne = createPostgresCapabilityAuthority(sqlPool);

    afterAll(async () => {
      await Promise.all([backendPool.end(), adminPool.end()]);
    });

    it("keeps command acceptance atomic and outbox publication fenced", async () => {
      const resolved = await authorityOne.resolveForServerContext({
        deployment_id: DEPLOYMENT_ID,
        tenant_id: TENANT_ONE,
        principal_id: OWNER_ONE,
        access: "WRITE",
      });
      if (!resolved.ok) throw new Error(resolved.error.code);
      const repository = createPostgresRepository(sqlPool, authorityOne.authorizer);
      const outbox = createPostgresOutbox(sqlPool, authorityOne.authorizer);
      const command = {
        run_id: randomUUID(),
        command_id: randomUUID(),
        event_id: randomUUID(),
        outbox_id: randomUUID(),
        audit_id: randomUUID(),
        idempotency_key: `integration-${randomUUID()}`,
        question: "为什么测试租户的订单转化率下降？",
        payload: { kind: "START_L2_RESEARCH", mode: "L2" },
      };

      const accepted = await repository.acceptCommand(resolved.value, command);
      if (!accepted.ok) {
        throw new Error(`${accepted.error.code}: ${accepted.error.message}`);
      }
      expect(accepted).toMatchObject({
        ok: true,
        value: {
          created: true,
          run_id: command.run_id,
          command_id: command.command_id,
          outbox_id: command.outbox_id,
        },
      });
      const persisted = await adminPool.query(
        `select
           (select count(*)::int from app_data_agent.runs where run_id = $1) as runs,
           (select count(*)::int from app_data_agent.commands where command_id = $2) as commands,
           (select count(*)::int from app_data_agent.idempotency_records
             where idempotency_key = $3) as idempotency,
           (select count(*)::int from app_data_agent.run_events
             where run_id = $1 and event_type = 'run.accepted') as events,
           (select count(*)::int from app_data_agent.outbox where outbox_id = $4) as outbox,
           (select count(*)::int from app_data_agent.audit_log
             where resource_id = $1::text and action = 'RUN_COMMAND_ACCEPTED') as audit`,
        [command.run_id, command.command_id, command.idempotency_key, command.outbox_id],
      );
      expect(persisted.rows[0]).toEqual({
        runs: 1,
        commands: 1,
        idempotency: 1,
        events: 1,
        outbox: 1,
        audit: 1,
      });

      expect(await repository.acceptCommand(resolved.value, command)).toMatchObject({
        ok: true,
        value: { created: false, run_id: command.run_id, command_id: command.command_id },
      });

      const conflictingIdempotencyKey = `integration-${randomUUID()}`;
      const conflict = await repository.acceptCommand(resolved.value, {
        ...command,
        command_id: randomUUID(),
        event_id: randomUUID(),
        outbox_id: randomUUID(),
        audit_id: randomUUID(),
        idempotency_key: conflictingIdempotencyKey,
      });
      expect(conflict).toMatchObject({
        ok: false,
        error: { code: "RUN_ALREADY_EXISTS" },
      });
      const rolledBack = await adminPool.query(
        `select count(*)::int as count
         from app_data_agent.idempotency_records
         where idempotency_key = $1`,
        [conflictingIdempotencyKey],
      );
      expect(rolledBack.rows[0]?.count).toBe(0);

      const published: string[] = [];
      expect(
        await outbox.publishOne(
          resolved.value,
          { worker_id: "integration-worker", lease_duration_ms: 10_000 },
          {
            async publish(message) {
              published.push(message.idempotency_key);
            },
          },
        ),
      ).toMatchObject({
        ok: true,
        value: { state: "PUBLISHED", outbox_id: command.outbox_id },
      });
      expect(published).toEqual([command.outbox_id]);
      const outboxState = await adminPool.query(
        `select status, lease_token::text as lease_token
         from app_data_agent.outbox
         where outbox_id = $1`,
        [command.outbox_id],
      );
      expect(outboxState.rows[0]).toEqual({ status: "PUBLISHED", lease_token: "1" });
    });

    it("prevents cross-tenant reads and forged capabilities on a privileged pool", async () => {
      const tenantTwo = await authorityOne.resolveForServerContext({
        deployment_id: DEPLOYMENT_ID,
        tenant_id: TENANT_TWO,
        principal_id: OWNER_TWO,
        access: "READ",
      });
      if (!tenantTwo.ok) throw new Error(tenantTwo.error.code);
      const fixtureRun = "00000000-0000-4000-8000-00000000a101";
      const backendRepository = createPostgresRepository(sqlPool, authorityOne.authorizer);
      expect(await backendRepository.getRun(tenantTwo.value, { run_id: fixtureRun })).toEqual({
        ok: true,
        value: null,
      });

      const privilegedRepository = createPostgresRepository(
        adaptPgPool(adminPool),
        authorityOne.authorizer,
      );
      expect(
        await privilegedRepository.getRun(
          {
            ...tenantTwo.value,
            scope: { ...tenantTwo.value.scope, tenant_id: TENANT_ONE },
          },
          { run_id: fixtureRun },
        ),
      ).toMatchObject({
        ok: false,
        error: { code: "APP_CAPABILITY_ISSUER_MISMATCH" },
      });
    });

    it("isolates idempotency keys by principal even on a privileged pool", async () => {
      const ownerCapability = await authorityOne.resolveForServerContext({
        deployment_id: DEPLOYMENT_ID,
        tenant_id: TENANT_ONE,
        principal_id: OWNER_ONE,
        access: "WRITE",
      });
      if (!ownerCapability.ok) throw new Error(ownerCapability.error.code);

      const otherPrincipal = randomUUID();
      await adminPool.query(
        "select platform.provision_membership($1::uuid, $2::uuid, $3::uuid, 'analyst')",
        [DEPLOYMENT_ID, TENANT_ONE, otherPrincipal],
      );
      const otherCapability = await authorityOne.resolveForServerContext({
        deployment_id: DEPLOYMENT_ID,
        tenant_id: TENANT_ONE,
        principal_id: otherPrincipal,
        access: "WRITE",
      });
      if (!otherCapability.ok) throw new Error(otherCapability.error.code);

      const sharedKey = `same-tenant-shared-${randomUUID()}`;
      const commandFor = (principalLabel: string) => ({
        run_id: randomUUID(),
        command_id: randomUUID(),
        event_id: randomUUID(),
        outbox_id: randomUUID(),
        audit_id: randomUUID(),
        idempotency_key: sharedKey,
        question: `${principalLabel} 的同租户隔离分析问题`,
        payload: { kind: "START_L2_RESEARCH", mode: "L2" as const },
      });
      const ownerCommand = commandFor("owner");
      const otherCommand = commandFor("analyst");
      const privilegedRepository = createPostgresRepository(
        adaptPgPool(adminPool),
        authorityOne.authorizer,
      );

      expect(
        await privilegedRepository.acceptCommand(ownerCapability.value, ownerCommand),
      ).toMatchObject({
        ok: true,
        value: {
          created: true,
          run_id: ownerCommand.run_id,
          command_id: ownerCommand.command_id,
        },
      });
      expect(
        await privilegedRepository.acceptCommand(otherCapability.value, otherCommand),
      ).toMatchObject({
        ok: true,
        value: {
          created: true,
          run_id: otherCommand.run_id,
          command_id: otherCommand.command_id,
        },
      });
      expect(
        await privilegedRepository.acceptCommand(ownerCapability.value, ownerCommand),
      ).toMatchObject({
        ok: true,
        value: {
          created: false,
          run_id: ownerCommand.run_id,
          command_id: ownerCommand.command_id,
        },
      });

      const records = await adminPool.query(
        `select principal_id::text, command_id::text
         from app_data_agent.idempotency_records
         where app_id = $1
           and tenant_id = $2
           and environment = 'test'
           and idempotency_key = $3
         order by principal_id`,
        [APP_ID, TENANT_ONE, sharedKey],
      );
      expect(records.rows).toEqual(
        [
          { principal_id: OWNER_ONE, command_id: ownerCommand.command_id },
          { principal_id: otherPrincipal, command_id: otherCommand.command_id },
        ].sort((left, right) => left.principal_id.localeCompare(right.principal_id)),
      );
    });

    it("replays one canonical command across browser RPC and backend repository entrypoints", async () => {
      const capability = await authorityOne.resolveForServerContext({
        deployment_id: DEPLOYMENT_ID,
        tenant_id: TENANT_ONE,
        principal_id: OWNER_ONE,
        access: "WRITE",
      });
      if (!capability.ok) throw new Error(capability.error.code);
      const runId = randomUUID();
      const commandId = randomUUID();
      const idempotencyKey = `cross-entrypoint-${randomUUID()}`;
      const question = "浏览器入口与后端入口必须共享同一规范化命令";
      const payload = {
        kind: "START_L2_RESEARCH",
        mode: "L2" as const,
        question_version: "v1",
      };
      const canonical = await adminPool.query<{ readonly payload_hash: string }>(
        "select platform.canonical_sha256($1::jsonb) as payload_hash",
        [payload],
      );
      const payloadHash = canonical.rows[0]?.payload_hash;
      if (!payloadHash) throw new Error("Canonical payload hash fixture missing.");

      const browser = await adminPool.connect();
      let transactionOpen = false;
      try {
        await browser.query("BEGIN");
        transactionOpen = true;
        await browser.query("SET LOCAL ROLE authenticated");
        await browser.query("select pg_catalog.set_config('request.jwt.claims', $1::text, true)", [
          JSON.stringify({ sub: OWNER_ONE }),
        ]);
        const accepted = await browser.query<{ readonly value: unknown }>(
          `select api.data_agent__accept_run_command(
             $1::uuid,
             $2::uuid,
             $3::uuid,
             $4::uuid,
             $5::text,
             $6::text,
             $7::jsonb,
             $8::text
           ) as value`,
          [
            DEPLOYMENT_ID,
            TENANT_ONE,
            runId,
            commandId,
            idempotencyKey,
            question,
            payload,
            payloadHash,
          ],
        );
        expect(accepted.rows[0]?.value).toMatchObject({
          replayed: false,
          run: { run_id: runId, principal_id: OWNER_ONE },
          command: { command_id: commandId, payload_hash: payloadHash },
        });
        await browser.query("COMMIT");
        transactionOpen = false;
      } finally {
        if (transactionOpen) await browser.query("ROLLBACK");
        browser.release();
      }

      const replayInput = {
        run_id: runId,
        command_id: commandId,
        event_id: randomUUID(),
        outbox_id: randomUUID(),
        audit_id: randomUUID(),
        idempotency_key: idempotencyKey,
        question,
        payload,
      };
      const privilegedRepository = createPostgresRepository(
        adaptPgPool(adminPool),
        authorityOne.authorizer,
      );
      expect(await privilegedRepository.acceptCommand(capability.value, replayInput)).toMatchObject(
        {
          ok: true,
          value: {
            created: false,
            run_id: runId,
            command_id: commandId,
            payload_hash: payloadHash,
          },
        },
      );
    });

    it("prevents same-tenant principals from probing another run's artifact on a privileged pool", async () => {
      const artifactId = randomUUID();
      const fixtureRun = "00000000-0000-4000-8000-00000000a101";
      const contentHash = `sha256:${"a".repeat(64)}`;
      await adminPool.query(
        `insert into app_data_agent.artifacts (
           app_id,
           tenant_id,
           environment,
           run_id,
           artifact_id,
           artifact_type,
           revision,
           content_hash,
           document_json,
           worker_fence,
           is_active
         )
         values ($1, $2, 'test', $3, $4, 'QuestionFrame', 1, $5, '{}'::jsonb, 0, true)`,
        [APP_ID, TENANT_ONE, fixtureRun, artifactId, contentHash],
      );
      const otherPrincipal = randomUUID();
      await adminPool.query(
        "select platform.provision_membership($1::uuid, $2::uuid, $3::uuid, 'analyst')",
        [DEPLOYMENT_ID, TENANT_ONE, otherPrincipal],
      );
      const otherCapability = await authorityOne.resolveForServerContext({
        deployment_id: DEPLOYMENT_ID,
        tenant_id: TENANT_ONE,
        principal_id: otherPrincipal,
        access: "READ",
      });
      if (!otherCapability.ok) throw new Error(otherCapability.error.code);
      const privilegedRepository = createPostgresRepository(
        adaptPgPool(adminPool),
        authorityOne.authorizer,
      );

      expect(
        await privilegedRepository.verifyCommitted(otherCapability.value, {
          app_id: APP_ID,
          tenant_id: TENANT_ONE,
          environment: "test",
          run_id: fixtureRun,
          artifact_id: artifactId,
          artifact_type: "QuestionFrame",
          revision: 1,
          content_hash: contentHash,
        }),
      ).toEqual({ ok: true, value: false });
    });

    it("round-trips a persisted SecretRef and refuses false provider-effect success", async () => {
      const resolved = await authorityOne.resolveForServerContext({
        deployment_id: DEPLOYMENT_ID,
        tenant_id: TENANT_ONE,
        principal_id: OWNER_ONE,
        access: "WRITE",
      });
      if (!resolved.ok) throw new Error(resolved.error.code);
      const secrets = createPostgresSecretRefRepository(sqlPool, authorityOne.authorizer);
      const secretRefId = randomUUID();
      const registered = await secrets.register(resolved.value, {
        secret_ref_id: secretRefId,
        secret_name: `Datasource_${secretRefId.replaceAll("-", "").slice(0, 12)}`,
        provider_ref_hash: `sha256:${"b".repeat(64)}`,
      });
      expect(registered).toMatchObject({
        ok: true,
        value: {
          ref: `secretref:${secretRefId}`,
          version: 1,
          status: "ACTIVE",
        },
      });
      if (!registered.ok) throw new Error(registered.error.code);

      const locatorAfterJsonRoundTrip = JSON.parse(
        JSON.stringify({ ref: registered.value.ref, expected_version: 1 }),
      );
      expect(await secrets.get(resolved.value, locatorAfterJsonRoundTrip)).toEqual({
        ok: true,
        value: registered.value,
      });

      const otherPrincipal = randomUUID();
      await adminPool.query(
        "select platform.provision_membership($1::uuid, $2::uuid, $3::uuid, 'analyst')",
        [DEPLOYMENT_ID, TENANT_ONE, otherPrincipal],
      );
      const otherCapability = await authorityOne.resolveForServerContext({
        deployment_id: DEPLOYMENT_ID,
        tenant_id: TENANT_ONE,
        principal_id: otherPrincipal,
        access: "READ",
      });
      if (!otherCapability.ok) throw new Error(otherCapability.error.code);
      const privilegedSecrets = createPostgresSecretRefRepository(
        adaptPgPool(adminPool),
        authorityOne.authorizer,
      );
      expect(await privilegedSecrets.get(otherCapability.value, locatorAfterJsonRoundTrip)).toEqual(
        {
          ok: true,
          value: null,
        },
      );

      const requestId = randomUUID();
      expect(
        await secrets.requestProviderEffect(resolved.value, {
          ref: registered.value.ref,
          expected_version: 1,
          request_id: requestId,
          operation: "ROTATE",
        }),
      ).toMatchObject({
        ok: true,
        value: { version: 1, status: "ROTATION_PENDING" },
      });
      expect(
        await secrets.finalizeProviderEffect(resolved.value, {
          ref: registered.value.ref,
          expected_version: 1,
          provider_receipt_id: randomUUID(),
        }),
      ).toMatchObject({ ok: false });

      const pending = await adminPool.query(
        `select status, version::int as version, provider_ref_hash
         from app_data_agent.secret_refs
         where secret_ref_id = $1`,
        [secretRefId],
      );
      expect(pending.rows[0]).toEqual({
        status: "ROTATION_PENDING",
        version: 1,
        provider_ref_hash: `sha256:${"b".repeat(64)}`,
      });
    });

    it("persists one-shot datasource egress approval across authority instances", async () => {
      const resolved = await authorityOne.resolveForServerContext({
        deployment_id: DEPLOYMENT_ID,
        tenant_id: TENANT_ONE,
        principal_id: OWNER_ONE,
        access: "WRITE",
      });
      if (!resolved.ok) throw new Error(resolved.error.code);
      const egressOne = createPostgresDatasourceEgress(sqlPool, authorityOne.authorizer);
      const createdPolicy = await egressOne.createPolicy(resolved.value, {
        datasource_id: "warehouse-primary",
        allowed_hosts: ["db.example.com"],
        allowed_ports: [5432],
        allowed_protocols: ["postgresql:"],
        allowed_roles: ["OWNER", "ANALYST"],
      });
      expect(createdPolicy).toMatchObject({
        ok: true,
        value: {
          datasource_id: "warehouse-primary",
          version: 1,
          status: "ACTIVE",
        },
      });
      if (!createdPolicy.ok) throw new Error(createdPolicy.error.code);

      expect(
        await withAppTransaction(
          sqlPool,
          authorityOne.authorizer,
          resolved.value,
          { access: "WRITE" },
          ({ client }) =>
            client.query(
              `select app_data_agent.register_datasource_egress_approval(
                 $1::uuid,
                 $2::uuid,
                 1,
                 'postgresql://db.example.com:5432/',
                 'db.example.com',
                 5432,
                 'postgresql:',
                 array['169.254.169.254'::inet],
                 pg_catalog.clock_timestamp() + interval '30 seconds'
               )`,
              [randomUUID(), createdPolicy.value.policy_id],
            ),
        ),
      ).toMatchObject({ ok: false });

      expect(
        await egressOne.approve(
          resolved.value,
          {
            policy_id: createdPolicy.value.policy_id,
            expected_policy_version: 1,
            datasource_id: "warehouse-primary",
            url: "postgresql://db.example.com:5432/",
          },
          { resolve: async () => ["169.254.169.254"] },
        ),
      ).toMatchObject({
        ok: false,
        error: { code: "DATASOURCE_ADDRESS_DENIED" },
      });
      expect(
        await egressOne.approve(
          resolved.value,
          {
            policy_id: createdPolicy.value.policy_id,
            expected_policy_version: 1,
            datasource_id: "warehouse-primary",
            url: "postgresql://db.example.com:5432/?password=plaintext",
          },
          { resolve: async () => ["8.8.8.8"] },
        ),
      ).toMatchObject({
        ok: false,
        error: { code: "DATASOURCE_URL_DENIED" },
      });

      const approved = await egressOne.approve(
        resolved.value,
        {
          policy_id: createdPolicy.value.policy_id,
          expected_policy_version: 1,
          datasource_id: "warehouse-primary",
          url: "postgresql://db.example.com:5432/",
        },
        { resolve: async () => ["8.8.8.8"] },
      );
      expect(approved).toMatchObject({
        ok: true,
        value: {
          status: "PINNED",
          pinned_addresses: ["8.8.8.8"],
        },
      });
      if (!approved.ok) throw new Error(approved.error.code);

      const tenantTwoCapability = await authorityOne.resolveForServerContext({
        deployment_id: DEPLOYMENT_ID,
        tenant_id: TENANT_TWO,
        principal_id: OWNER_TWO,
        access: "WRITE",
      });
      if (!tenantTwoCapability.ok) {
        throw new Error(tenantTwoCapability.error.code);
      }
      expect(
        await egressOne.verify(
          tenantTwoCapability.value,
          {
            approval_id: approved.value.approval_id,
            expected_policy_version: 1,
          },
          { resolve: async () => ["8.8.8.8"] },
        ),
      ).toMatchObject({
        ok: false,
        error: { code: "DATASOURCE_APPROVAL_STALE_OR_FORBIDDEN" },
      });

      const restartedAuthority = createPostgresCapabilityAuthority(adaptPgPool(backendPool));
      const restartedCapability = await restartedAuthority.resolveForServerContext({
        deployment_id: DEPLOYMENT_ID,
        tenant_id: TENANT_ONE,
        principal_id: OWNER_ONE,
        access: "WRITE",
      });
      if (!restartedCapability.ok) {
        throw new Error(restartedCapability.error.code);
      }
      const egressAfterRestart = createPostgresDatasourceEgress(
        adaptPgPool(backendPool),
        restartedAuthority.authorizer,
      );
      const verified = await egressAfterRestart.verify(
        restartedCapability.value,
        {
          approval_id: approved.value.approval_id,
          expected_policy_version: 1,
        },
        { resolve: async () => ["8.8.8.8"] },
      );
      expect(verified).toMatchObject({
        ok: true,
        value: { status: "VERIFIED", pinned_addresses: ["8.8.8.8"] },
      });
      if (!verified.ok) throw new Error(verified.error.code);

      expect(
        await egressAfterRestart.consumeTarget(restartedCapability.value, {
          approval_id: verified.value.approval_id,
          expected_policy_version: 1,
        }),
      ).toEqual({
        ok: true,
        value: expect.objectContaining({
          address: "8.8.8.8",
          port: 5432,
          server_name: "db.example.com",
          protocol: "postgresql:",
          redirects: "DENY",
        }),
      });
      expect(
        await egressAfterRestart.consumeTarget(restartedCapability.value, {
          approval_id: verified.value.approval_id,
          expected_policy_version: 1,
        }),
      ).toMatchObject({
        ok: false,
        error: { code: "DATASOURCE_APPROVAL_STALE_OR_FORBIDDEN" },
      });

      expect(
        await egressAfterRestart.revokePolicy(restartedCapability.value, {
          policy_id: createdPolicy.value.policy_id,
          expected_version: 1,
        }),
      ).toMatchObject({
        ok: true,
        value: { status: "REVOKED", version: 2 },
      });
      expect(
        await egressAfterRestart.approve(
          restartedCapability.value,
          {
            policy_id: createdPolicy.value.policy_id,
            expected_policy_version: 1,
            datasource_id: "warehouse-primary",
            url: "postgresql://db.example.com:5432/",
          },
          { resolve: async () => ["8.8.8.8"] },
        ),
      ).toMatchObject({
        ok: false,
        error: { code: "DATASOURCE_POLICY_STALE_OR_FORBIDDEN" },
      });
    });

    it("serializes policy revocation ahead of a concurrent approval consume", async () => {
      const resolved = await authorityOne.resolveForServerContext({
        deployment_id: DEPLOYMENT_ID,
        tenant_id: TENANT_ONE,
        principal_id: OWNER_ONE,
        access: "WRITE",
      });
      if (!resolved.ok) throw new Error(resolved.error.code);
      const egress = createPostgresDatasourceEgress(sqlPool, authorityOne.authorizer);
      const datasourceId = `warehouse-race-${randomUUID()}`;
      const createdPolicy = await egress.createPolicy(resolved.value, {
        datasource_id: datasourceId,
        allowed_hosts: ["race.example.com"],
        allowed_ports: [5432],
        allowed_protocols: ["postgresql:"],
        allowed_roles: ["OWNER"],
      });
      if (!createdPolicy.ok) throw new Error(createdPolicy.error.code);
      const approved = await egress.approve(
        resolved.value,
        {
          policy_id: createdPolicy.value.policy_id,
          expected_policy_version: 1,
          datasource_id: datasourceId,
          url: "postgresql://race.example.com:5432/",
        },
        { resolve: async () => ["8.8.4.4"] },
      );
      if (!approved.ok) throw new Error(approved.error.code);
      const verified = await egress.verify(
        resolved.value,
        {
          approval_id: approved.value.approval_id,
          expected_policy_version: 1,
        },
        { resolve: async () => ["8.8.4.4"] },
      );
      if (!verified.ok) throw new Error(verified.error.code);

      const revoker = await adminPool.connect();
      let transactionOpen = false;
      try {
        await revoker.query("BEGIN");
        transactionOpen = true;
        await revoker.query(
          `update app_data_agent.datasource_egress_policies
           set status = 'REVOKED',
               version = version + 1,
               revoked_at = pg_catalog.clock_timestamp(),
               updated_at = pg_catalog.clock_timestamp()
           where app_id = $1
             and tenant_id = $2
             and environment = 'test'
             and policy_id = $3
             and version = 1
             and status = 'ACTIVE'`,
          [APP_ID, TENANT_ONE, createdPolicy.value.policy_id],
        );

        let settled = false;
        const consume = egress
          .consumeTarget(resolved.value, {
            approval_id: verified.value.approval_id,
            expected_policy_version: 1,
          })
          .finally(() => {
            settled = true;
          });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(settled).toBe(false);

        await revoker.query("COMMIT");
        transactionOpen = false;
        expect(await consume).toMatchObject({
          ok: false,
          error: { code: "DATASOURCE_APPROVAL_STALE_OR_FORBIDDEN" },
        });
      } finally {
        if (transactionOpen) await revoker.query("ROLLBACK");
        revoker.release();
      }
    });

    it("observes revoke and lifecycle epoch changes across authority instances", async () => {
      const authorityTwo = createPostgresCapabilityAuthority(adaptPgPool(backendPool));
      const beforeRevoke = await authorityOne.resolveForServerContext({
        deployment_id: DEPLOYMENT_ID,
        tenant_id: TENANT_ONE,
        principal_id: OWNER_ONE,
        access: "WRITE",
      });
      if (!beforeRevoke.ok) throw new Error(beforeRevoke.error.code);

      await adminPool.query("select platform.revoke_membership($1::uuid, $2::uuid, $3::uuid)", [
        DEPLOYMENT_ID,
        TENANT_ONE,
        OWNER_ONE,
      ]);
      expect(
        await authorityOne.authorizer.revalidate(beforeRevoke.value, ["OWNER", "ANALYST"], "WRITE"),
      ).toMatchObject({
        ok: false,
        error: { code: "APP_AUTHORITY_STALE_OR_FORBIDDEN" },
      });
      expect(
        await authorityTwo.resolveForServerContext({
          deployment_id: DEPLOYMENT_ID,
          tenant_id: TENANT_ONE,
          principal_id: OWNER_ONE,
          access: "READ",
        }),
      ).toMatchObject({ ok: false, error: { code: "APP_SCOPE_FORBIDDEN" } });

      await adminPool.query(
        "select platform.provision_membership($1::uuid, $2::uuid, $3::uuid, 'owner')",
        [DEPLOYMENT_ID, TENANT_ONE, OWNER_ONE],
      );
      const reprovisioned = await authorityTwo.resolveForServerContext({
        deployment_id: DEPLOYMENT_ID,
        tenant_id: TENANT_ONE,
        principal_id: OWNER_ONE,
        access: "WRITE",
      });
      if (!reprovisioned.ok) throw new Error(reprovisioned.error.code);
      expect(
        await authorityOne.authorizer.revalidate(
          beforeRevoke.value,
          ["OWNER", "ANALYST", "VIEWER"],
          "READ",
        ),
      ).toMatchObject({
        ok: false,
        error: { code: "APP_AUTHORITY_STALE_OR_FORBIDDEN" },
      });

      await adminPool.query(
        `update platform.app_environment_lifecycle
         set lifecycle_state = 'FROZEN',
             authority_epoch = authority_epoch + 1
         where app_id = $1
           and environment = $2`,
        [APP_ID, "test"],
      );
      expect(
        await authorityTwo.authorizer.revalidate(
          reprovisioned.value,
          ["OWNER", "ANALYST"],
          "WRITE",
        ),
      ).toMatchObject({
        ok: false,
        error: { code: "APP_AUTHORITY_STALE_OR_FORBIDDEN" },
      });
      const authorityThree = createPostgresCapabilityAuthority(adaptPgPool(backendPool));
      expect(
        await authorityThree.resolveForServerContext({
          deployment_id: DEPLOYMENT_ID,
          tenant_id: TENANT_ONE,
          principal_id: OWNER_ONE,
          access: "WRITE",
        }),
      ).toMatchObject({ ok: false, error: { code: "APP_SCOPE_FORBIDDEN" } });
      const frozenRead = await authorityThree.resolveForServerContext({
        deployment_id: DEPLOYMENT_ID,
        tenant_id: TENANT_ONE,
        principal_id: OWNER_ONE,
        access: "READ",
      });
      expect(frozenRead).toMatchObject({
        ok: true,
        value: { scope: { app_id: APP_ID, tenant_id: TENANT_ONE, environment: "test" } },
      });
      if (!frozenRead.ok) throw new Error(frozenRead.error.code);
      const frozenRepository = createPostgresRepository(sqlPool, authorityThree.authorizer);
      expect(
        await frozenRepository.getRun(frozenRead.value, {
          run_id: "00000000-0000-4000-8000-00000000a101",
        }),
      ).toMatchObject({
        ok: true,
        value: {
          run_id: "00000000-0000-4000-8000-00000000a101",
          principal_id: OWNER_ONE,
        },
      });
      expect(
        await frozenRepository.acceptCommand(frozenRead.value, {
          run_id: randomUUID(),
          command_id: randomUUID(),
          event_id: randomUUID(),
          outbox_id: randomUUID(),
          audit_id: randomUUID(),
          idempotency_key: `frozen-${randomUUID()}`,
          question: "冻结期间不应接受新的分析命令",
          payload: { kind: "START_L2_RESEARCH", mode: "L2" },
        }),
      ).toMatchObject({
        ok: false,
        error: { code: "APP_OPERATION_FROZEN", retryable: false },
      });

      await adminPool.query(
        `update platform.app_environment_lifecycle
         set lifecycle_state = 'ACTIVE',
             authority_epoch = authority_epoch + 1
         where app_id = $1
           and environment = $2`,
        [APP_ID, "test"],
      );
      expect(
        frozenRead.ok &&
          (await authorityThree.authorizer.revalidate(
            frozenRead.value,
            ["OWNER", "ANALYST", "VIEWER"],
            "READ",
          )),
      ).toMatchObject({
        ok: false,
        error: { code: "APP_AUTHORITY_STALE_OR_FORBIDDEN" },
      });
      expect(
        await createPostgresCapabilityAuthority(adaptPgPool(backendPool)).resolveForServerContext({
          deployment_id: DEPLOYMENT_ID,
          tenant_id: TENANT_ONE,
          principal_id: OWNER_ONE,
          access: "WRITE",
        }),
      ).toMatchObject({ ok: true, value: { role: "OWNER" } });
    });
  },
);
