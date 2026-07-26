\set ON_ERROR_STOP on

create or replace function test_support.runtime_lease_document(
  requested_claim jsonb
)
returns jsonb
language sql
stable
strict
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'schema_version',
    '1.0.0',
    'scope',
    pg_catalog.jsonb_build_object(
      'app_id',
      pg_catalog.current_setting('data_agent.app_id'),
      'tenant_id',
      pg_catalog.current_setting('data_agent.tenant_id'),
      'environment',
      pg_catalog.current_setting('data_agent.environment')
    ),
    'outbox_id',
    requested_claim ->> 'outbox_id',
    'run_id',
    requested_claim ->> 'run_id',
    'command_id',
    requested_claim ->> 'command_id',
    'command_kind',
    requested_claim ->> 'command_kind',
    'attempt_id',
    requested_claim ->> 'attempt_id',
    'attempt_no',
    (requested_claim ->> 'attempt_no')::integer,
    'delivery_attempt_no',
    (requested_claim ->> 'delivery_attempt_no')::integer,
    'lease_duration_ms',
    (requested_claim ->> 'lease_duration_ms')::integer,
    'worker_id',
    requested_claim ->> 'worker_id',
    'lease_token',
    (requested_claim ->> 'lease_token')::bigint,
    'worker_fence',
    (requested_claim ->> 'worker_fence')::bigint,
    'expires_at',
    app_data_agent.runtime_iso_timestamp(
      (requested_claim ->> 'expires_at')::timestamptz
    ),
    'payload',
    requested_claim -> 'payload'
  )
$$;

create or replace function test_support.append_run_event_canonical(
  requested_lease jsonb,
  requested_event jsonb,
  expected_projection_hash text,
  requested_projection jsonb
)
returns jsonb
language sql
set search_path = ''
as $$
  select app_data_agent.append_run_event(
    requested_lease,
    requested_event,
    app_data_agent.runtime_canonical_sha256(requested_event),
    expected_projection_hash,
    requested_projection,
    app_data_agent.runtime_canonical_sha256(requested_projection)
  )
$$;

create or replace function test_support.request_run_control_canonical(
  requested_command jsonb,
  requested_event jsonb,
  expected_projection_hash text,
  requested_projection jsonb
)
returns jsonb
language sql
set search_path = ''
as $$
  select app_data_agent.request_run_control(
    requested_command,
    requested_event,
    app_data_agent.runtime_canonical_sha256(requested_event),
    expected_projection_hash,
    requested_projection,
    app_data_agent.runtime_canonical_sha256(requested_projection)
  )
$$;

create or replace function test_support.reduce_run_projection(
  current_projection jsonb,
  requested_event jsonb
)
returns jsonb
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select app_data_agent.reduce_run_projection_document(
    current_projection,
    requested_event
  )
$$;

create or replace function test_support.accept_backend_start_run(
  requested_run_id uuid,
  requested_command_id uuid,
  requested_event_id uuid,
  requested_outbox_id uuid,
  requested_audit_id uuid,
  requested_idempotency_key text,
  requested_question text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  requested_payload jsonb :=
    '{"kind":"START_L2_RESEARCH","mode":"L2"}'::jsonb;
  requested_payload_hash text;
  requested_occurred_at text;
  requested_command jsonb;
  requested_event jsonb;
begin
  requested_payload_hash :=
    platform.canonical_sha256(requested_payload);
  requested_occurred_at :=
    app_data_agent.runtime_iso_timestamp(
      pg_catalog.clock_timestamp()
    );
  requested_command := pg_catalog.jsonb_build_object(
    'run_id',
    requested_run_id,
    'command_id',
    requested_command_id,
    'event_id',
    requested_event_id,
    'outbox_id',
    requested_outbox_id,
    'audit_id',
    requested_audit_id,
    'idempotency_key',
    requested_idempotency_key,
    'question',
    requested_question,
    'payload',
    requested_payload
  );
  requested_event := pg_catalog.jsonb_build_object(
    'schema_version',
    '1.0.0',
    'event_id',
    requested_event_id,
    'scope',
    pg_catalog.jsonb_build_object(
      'app_id',
      pg_catalog.current_setting('data_agent.app_id'),
      'tenant_id',
      pg_catalog.current_setting('data_agent.tenant_id'),
      'environment',
      pg_catalog.current_setting('data_agent.environment')
    ),
    'run_id',
    requested_run_id,
    'sequence',
    1,
    'worker_fence',
    0,
    'idempotency_key',
    'event:' || requested_event_id::text,
    'occurred_at',
    requested_occurred_at,
    'event_type',
    'run.accepted',
    'payload',
    pg_catalog.jsonb_build_object(
      'command_id',
      requested_command_id,
      'payload_hash',
      requested_payload_hash
    )
  );
  return app_data_agent.accept_backend_run_command(
    requested_command,
    requested_payload_hash,
    requested_event,
    app_data_agent.runtime_canonical_sha256(requested_event)
  );
end
$$;

create or replace function test_support.append_reduced_run_event(
  requested_lease jsonb,
  requested_event jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  current_projection app_data_agent.run_projections%rowtype;
  requested_projection jsonb;
begin
  select projection.*
  into strict current_projection
  from app_data_agent.run_projections as projection
  where projection.app_id =
      (requested_event -> 'scope' ->> 'app_id')::uuid
    and projection.tenant_id =
      (requested_event -> 'scope' ->> 'tenant_id')::uuid
    and projection.environment =
      requested_event -> 'scope' ->> 'environment'
    and projection.run_id =
      (requested_event ->> 'run_id')::uuid
  order by projection.version desc
  limit 1;
  requested_projection := test_support.reduce_run_projection(
    current_projection.projection_json,
    requested_event
  );
  return test_support.append_run_event_canonical(
    requested_lease,
    requested_event,
    current_projection.projection_hash,
    requested_projection
  );
end
$$;

revoke all privileges on function test_support.runtime_lease_document(
  jsonb
) from public;
revoke all privileges on function test_support.append_run_event_canonical(
  jsonb,
  jsonb,
  text,
  jsonb
) from public;
revoke all privileges on function test_support.request_run_control_canonical(
  jsonb,
  jsonb,
  text,
  jsonb
) from public;
revoke all privileges on function test_support.reduce_run_projection(
  jsonb,
  jsonb
) from public;
revoke all privileges on function test_support.accept_backend_start_run(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text
) from public;
revoke all privileges on function
  test_support.append_reduced_run_event(jsonb, jsonb)
from public;
grant execute on function test_support.runtime_lease_document(
  jsonb
) to data_agent_backend;
grant execute on function test_support.append_run_event_canonical(
  jsonb,
  jsonb,
  text,
  jsonb
) to data_agent_backend;
grant execute on function test_support.request_run_control_canonical(
  jsonb,
  jsonb,
  text,
  jsonb
) to data_agent_backend;
grant execute on function test_support.reduce_run_projection(
  jsonb,
  jsonb
) to data_agent_backend;
grant execute on function test_support.accept_backend_start_run(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text
) to data_agent_backend;
grant execute on function
  test_support.append_reduced_run_event(jsonb, jsonb)
to data_agent_backend;

select test_support.assert_true(
  pg_catalog.to_regprocedure(
    'app_data_agent.claim_run_work(text,integer,integer)'
  ) is not null
  and pg_catalog.to_regprocedure(
    'app_data_agent.heartbeat_run_work(uuid,uuid,text,bigint,bigint,integer)'
  ) is not null
  and pg_catalog.to_regprocedure(
    'app_data_agent.append_run_event(jsonb,jsonb,text,text,jsonb,text)'
  ) is not null
  and pg_catalog.to_regprocedure(
    'app_data_agent.commit_run_checkpoint(jsonb,jsonb)'
  ) is not null
  and pg_catalog.to_regprocedure(
    'app_data_agent.commit_run_effect_receipt(jsonb,jsonb)'
  ) is not null
  and pg_catalog.to_regprocedure(
    'app_data_agent.accept_backend_run_command(jsonb,text,jsonb,text)'
  ) is not null
  and pg_catalog.to_regprocedure(
    'app_data_agent.lock_owned_run_fence(uuid)'
  ) is not null,
  'U4 必须提供持久 Run Lease、事件提交、Backend 接收与 Fence 行锁窄函数'
);

with legacy_function(function_name) as (
  values
    ('app_data_agent.claim_outbox(text,integer,integer)'),
    ('app_data_agent.publish_outbox(uuid,text,bigint)'),
    ('app_data_agent.retry_outbox(uuid,text,bigint,bigint)'),
    ('app_data_agent.advance_run_fence(uuid,bigint)')
),
application_role(role_name) as (
  values
    ('public'),
    ('anon'),
    ('authenticated'),
    ('service_role'),
    ('data_agent_backend'),
    ('data_agent_platform_owner'),
    ('data_agent_job_authority'),
    ('data_agent_secret_authority')
)
select test_support.assert_true(
  not exists (
    select 1
    from legacy_function
    cross join application_role
    where pg_catalog.has_function_privilege(
      application_role.role_name,
      legacy_function.function_name,
      'EXECUTE'
    )
  ),
  'Legacy Outbox 与 Fence SECURITY DEFINER API 必须对全部应用角色撤权'
);

with runtime_function(function_name) as (
  values
    ('app_data_agent.claim_run_work(text,integer,integer)'),
    (
      'app_data_agent.heartbeat_run_work(uuid,uuid,text,bigint,bigint,integer)'
    ),
    (
      'app_data_agent.append_run_event(jsonb,jsonb,text,text,jsonb,text)'
    ),
    (
      'app_data_agent.complete_run_work(uuid,uuid,text,bigint,bigint,bigint)'
    ),
    (
      'app_data_agent.retry_run_work(uuid,uuid,text,bigint,bigint,bigint,text,bigint)'
    ),
    ('app_data_agent.commit_run_checkpoint(jsonb,jsonb)'),
    ('app_data_agent.commit_run_effect_receipt(jsonb,jsonb)'),
    (
      'app_data_agent.request_run_control(jsonb,jsonb,text,text,jsonb,text)'
    ),
    (
      'app_data_agent.accept_backend_run_command(jsonb,text,jsonb,text)'
    ),
    ('app_data_agent.lock_owned_run_fence(uuid)')
)
select test_support.assert_true(
  not exists (
    select 1
    from runtime_function
    where not pg_catalog.has_function_privilege(
      'data_agent_backend',
      runtime_function.function_name,
      'EXECUTE'
    )
  )
  and not exists (
    select 1
    from runtime_function
    where pg_catalog.has_function_privilege(
      'public',
      runtime_function.function_name,
      'EXECUTE'
    )
  ),
  'Backend 必须保留 U4 窄 Runtime API，PUBLIC 必须全部撤权'
);

select test_support.assert_true(
  (
    select
      pg_catalog.strpos(
        function_definition.definition,
        'requested_idempotency_key is null'
      ) > 0
      and pg_catalog.strpos(
        function_definition.definition,
        'pg_catalog.length(requested_idempotency_key) not between 1 and 256'
      ) > 0
      and pg_catalog.strpos(
        function_definition.definition,
        'app_data_agent.contains_potential_plaintext_secret'
      ) > 0
      and pg_catalog.strpos(
        function_definition.definition,
        'requested_idempotency_key is null'
      ) < pg_catalog.strpos(
        function_definition.definition,
        'from platform.authorize_browser_context'
      )
      and pg_catalog.strpos(
        function_definition.definition,
        'pg_catalog.length(requested_idempotency_key) not between 1 and 256'
      ) < pg_catalog.strpos(
        function_definition.definition,
        'from platform.authorize_browser_context'
      )
      and pg_catalog.strpos(
        function_definition.definition,
        'app_data_agent.contains_potential_plaintext_secret'
      ) < pg_catalog.strpos(
        function_definition.definition,
        'from platform.authorize_browser_context'
      )
    from (
      select pg_catalog.lower(
        pg_catalog.pg_get_functiondef(
          pg_catalog.to_regprocedure(
            'api.data_agent__accept_run_command(uuid,uuid,uuid,uuid,text,text,jsonb,text)'
          )
        )
      ) as definition
    ) as function_definition
  ),
  'Browser 幂等键必须在授权、生命周期锁与持久化之前完成边界校验'
);

with expected_index (
  index_name,
  key_columns,
  included_columns,
  required_statuses,
  excluded_statuses,
  required_predicates
) as (
  values
    (
      'outbox_runtime_normal_claim_scope',
      array[
        'app_id',
        'tenant_id',
        'environment',
        'claimable_at',
        'created_at',
        'outbox_id'
      ]::text[],
      array[
        'run_id',
        'command_id',
        'topic',
        'status',
        'attempt_count',
        'lease_expires_at',
        'active_attempt_id',
        'queue_sequence'
      ]::text[],
      array['PENDING', 'FAILED', 'LEASED']::text[],
      array[]::text[],
      array[
        'run.command.accepted',
        'run.work.resume',
        'attempt_count < 5'
      ]::text[]
    ),
    (
      'outbox_runtime_exhausted_claim_scope',
      array[
        'app_id',
        'tenant_id',
        'environment',
        'claimable_at',
        'created_at',
        'outbox_id'
      ]::text[],
      array[
        'run_id',
        'command_id',
        'topic',
        'status',
        'attempt_count',
        'lease_expires_at',
        'active_attempt_id',
        'queue_sequence'
      ]::text[],
      array['LEASED']::text[],
      array['PENDING', 'FAILED']::text[],
      array[
        'run.command.accepted',
        'run.work.resume',
        'attempt_count >= 5'
      ]::text[]
    ),
    (
      'outbox_runtime_per_run_order',
      array[
        'app_id',
        'tenant_id',
        'environment',
        'run_id',
        'queue_sequence'
      ]::text[],
      array['outbox_id', 'command_id', 'topic', 'status']::text[],
      array['PENDING', 'FAILED', 'LEASED']::text[],
      array[]::text[],
      array['run.command.accepted', 'run.work.resume']::text[]
    )
),
actual_index as (
  select
    expected.*,
    index_definition.indexrelid,
    index_definition.indrelid,
    index_definition.indisvalid,
    index_definition.indisready,
    index_definition.indpred,
    pg_catalog.pg_get_expr(
      index_definition.indpred,
      index_definition.indrelid
    ) as predicate,
    columns.key_columns as actual_key_columns,
    columns.included_columns as actual_included_columns
  from expected_index as expected
  left join pg_catalog.pg_index as index_definition
    on index_definition.indexrelid = pg_catalog.to_regclass(
      'app_data_agent.' || expected.index_name
    )
  left join lateral (
    select
      pg_catalog.array_agg(
        attribute.attname::text
        order by index_key.position
      ) filter (
        where index_key.position <= index_definition.indnkeyatts
      ) as key_columns,
      pg_catalog.array_agg(
        attribute.attname::text
        order by index_key.position
      ) filter (
        where index_key.position > index_definition.indnkeyatts
      ) as included_columns
    from pg_catalog.unnest(index_definition.indkey)
      with ordinality as index_key(attnum, position)
    join pg_catalog.pg_attribute as attribute
      on attribute.attrelid = index_definition.indrelid
     and attribute.attnum = index_key.attnum
  ) as columns on true
)
select test_support.assert_true(
  coalesce(
    (
      select pg_catalog.bool_and(
        actual.indexrelid is not null
        and actual.indrelid = 'app_data_agent.outbox'::pg_catalog.regclass
        and actual.indisvalid
        and actual.indisready
        and actual.indpred is not null
        and actual.actual_key_columns = actual.key_columns
        and actual.actual_included_columns = actual.included_columns
        and not exists (
          select 1
          from pg_catalog.unnest(actual.required_statuses)
            as required(status)
          where pg_catalog.strpos(
            actual.predicate,
            pg_catalog.quote_literal(required.status)
          ) = 0
        )
        and not exists (
          select 1
          from pg_catalog.unnest(actual.excluded_statuses)
            as excluded(status)
          where pg_catalog.strpos(
            actual.predicate,
            pg_catalog.quote_literal(excluded.status)
          ) > 0
        )
        and not exists (
          select 1
          from pg_catalog.unnest(actual.required_predicates)
            as required(fragment)
          where pg_catalog.strpos(
            actual.predicate,
            required.fragment
          ) = 0
        )
      )
      from actual_index as actual
    ),
    false
  ),
  'U4 Claim 索引必须覆盖 claimable time、预算优先级与不可变每 Run 顺序'
);

select test_support.assert_true(
  (
    select
      index_definition.indisunique
      and index_definition.indisvalid
      and index_definition.indisready
      and columns.key_columns = array[
        'app_id',
        'tenant_id',
        'environment',
        'run_id',
        'queue_sequence'
      ]::text[]
    from pg_catalog.pg_index as index_definition
    cross join lateral (
      select pg_catalog.array_agg(
        attribute.attname::text
        order by index_key.position
      ) as key_columns
      from pg_catalog.unnest(index_definition.indkey)
        with ordinality as index_key(attnum, position)
      join pg_catalog.pg_attribute as attribute
        on attribute.attrelid = index_definition.indrelid
       and attribute.attnum = index_key.attnum
    ) as columns
    where index_definition.indexrelid = pg_catalog.to_regclass(
      'app_data_agent.outbox_runtime_run_sequence_unique'
    )
  ),
  'U4 每 Run Queue Sequence 必须由 Scope 唯一索引保证无碰撞'
);

select test_support.assert_true(
  exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'app_data_agent.outbox'::pg_catalog.regclass
      and attribute.attname = 'queue_sequence'
      and attribute.attidentity = ''
      and attribute.attnotnull
  )
  and not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_attrdef as default_definition
      on default_definition.adrelid = attribute.attrelid
     and default_definition.adnum = attribute.attnum
    where attribute.attrelid = 'app_data_agent.outbox'::pg_catalog.regclass
      and attribute.attname = 'queue_sequence'
  )
  and exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_attrdef as default_definition
      on default_definition.adrelid = attribute.attrelid
     and default_definition.adnum = attribute.attnum
    where attribute.attrelid = 'app_data_agent.runs'::pg_catalog.regclass
      and attribute.attname = 'next_queue_sequence'
      and attribute.attnotnull
      and attribute.attidentity = ''
      and pg_catalog.pg_get_expr(
        default_definition.adbin,
        default_definition.adrelid
      ) = '1'
  )
  and exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'app_data_agent.outbox'::pg_catalog.regclass
      and attribute.attname = 'claimable_at'
      and attribute.attgenerated = 's'
      and attribute.attnotnull
  )
  and pg_catalog.to_regclass(
    'app_data_agent.outbox_queue_sequence_seq'
  ) is null
  and not pg_catalog.has_column_privilege(
    'data_agent_backend',
    'app_data_agent.runs',
    'next_queue_sequence',
    'UPDATE'
  )
  and pg_catalog.strpos(
    pg_catalog.lower(
      pg_catalog.pg_get_functiondef(
        pg_catalog.to_regprocedure(
          'api.data_agent__accept_run_command(uuid,uuid,uuid,uuid,text,text,jsonb,text)'
        )
      )
    ),
    'next_queue_sequence'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.lower(
      pg_catalog.pg_get_functiondef(
        pg_catalog.to_regprocedure(
          'api.data_agent__accept_run_command(uuid,uuid,uuid,uuid,text,text,jsonb,text)'
        )
      )
    ),
    'queue_sequence'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.lower(
      pg_catalog.pg_get_functiondef(
        pg_catalog.to_regprocedure(
          'app_data_agent.request_run_control(jsonb,jsonb,text,text,jsonb,text)'
        )
      )
    ),
    'for update'
  ) > 0
  and not exists (
    select 1
    from app_data_agent.outbox as message
    where message.queue_sequence < 1
      or message.claimable_at is distinct from case
        when message.status = 'LEASED' then message.lease_expires_at
        else message.available_at
      end
  )
  and not exists (
    select 1
    from app_data_agent.outbox as message
    join app_data_agent.runs as run
      on run.app_id = message.app_id
     and run.tenant_id = message.tenant_id
     and run.environment = message.environment
     and run.run_id = message.run_id
    where message.queue_sequence >= run.next_queue_sequence
  ),
  'U4 Outbox 必须由 Run 行锁和每 Run Counter 分配不可变顺序与可索引 Claimable Time'
);

select test_support.assert_true(
  (
    select pg_catalog.bool_and(
      class.relrowsecurity and class.relforcerowsecurity
    )
    from pg_catalog.pg_class as class
    where class.oid in (
      'app_data_agent.run_attempts'::pg_catalog.regclass,
      'app_data_agent.run_projections'::pg_catalog.regclass,
      'app_data_agent.run_checkpoints'::pg_catalog.regclass,
      'app_data_agent.run_effect_receipts'::pg_catalog.regclass
    )
  ),
  'U4 Runtime 权威表必须全部 FORCE RLS'
);
select test_support.assert_true(
  not pg_catalog.has_table_privilege(
    'data_agent_backend',
    'app_data_agent.run_projections',
    'UPDATE'
  )
  and not pg_catalog.has_table_privilege(
    'data_agent_backend',
    'app_data_agent.run_effect_receipts',
    'INSERT'
  )
  and not pg_catalog.has_function_privilege(
    'public',
    'app_data_agent.claim_run_work(text,integer,integer)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.accept_backend_run_command(jsonb,text,jsonb,text)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.lock_owned_run_fence(uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'public',
    'app_data_agent.accept_backend_run_command(jsonb,text,jsonb,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'public',
    'app_data_agent.lock_owned_run_fence(uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_table_privilege(
    'data_agent_backend',
    'app_data_agent.runs',
    'INSERT'
  )
  and not pg_catalog.has_table_privilege(
    'data_agent_backend',
    'app_data_agent.commands',
    'INSERT'
  )
  and not pg_catalog.has_table_privilege(
    'data_agent_backend',
    'app_data_agent.idempotency_records',
    'INSERT'
  )
  and not pg_catalog.has_table_privilege(
    'data_agent_backend',
    'app_data_agent.run_events',
    'INSERT'
  )
  and not pg_catalog.has_table_privilege(
    'data_agent_backend',
    'app_data_agent.outbox',
    'INSERT'
  )
  and not pg_catalog.has_table_privilege(
    'data_agent_backend',
    'app_data_agent.audit_log',
    'INSERT'
  ),
  'Backend 首写与 Runtime 提交必须只经过窄函数，PUBLIC 不得执行'
);

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000001001"}',
  false
);
select api.data_agent__accept_run_command(
  '00000000-0000-4000-8000-00000000de01'::uuid,
  '00000000-0000-4000-8000-00000000aa11'::uuid,
  '00000000-0000-4000-8000-00000000a240'::uuid,
  '00000000-0000-4000-8000-00000000c240'::uuid,
  'runtime-u4-start',
  'U4 durable runtime smoke',
  '{"kind":"START_L2_RESEARCH","mode":"L2"}'::jsonb,
  'sha256:a51cad25baa6916772c6e63149ac066d5059dc6c5d721a66c2d35fa3121bd418'
);
reset role;

select test_support.assert_true(
  app_data_agent.runtime_canonical_json(
    '{"n":0.0000001}'::jsonb
  ) = '{"n":0.0000001}'
  and app_data_agent.runtime_canonical_json(
    '{"n":140751465587434200}'::jsonb
  ) = '{"n":140751465587434200}',
  'Runtime canonical JSON 必须保留 PostgreSQL numeric 权威表示，不模拟 ECMAScript NumberToString'
);

select test_support.assert_true(
  app_data_agent.runtime_canonical_json(
    pg_catalog.jsonb_build_object(
      'n',
      0.0000001::numeric,
      pg_catalog.chr(65536),
      'supplementary',
      pg_catalog.chr(57344),
      'bmp'
    )
  ) =
    '{"n":0.0000001,"' ||
    pg_catalog.chr(65536) ||
    '":"supplementary","' ||
    pg_catalog.chr(57344) ||
    '":"bmp"}',
  'Runtime canonical JSON 必须使用 PostgreSQL numeric 表示与确定性 UTF-16 Key 顺序'
);

select test_support.assert_true(
  app_data_agent.runtime_canonical_sha256(
    pg_catalog.jsonb_build_object(
      'n',
      0.0000001::numeric,
      pg_catalog.chr(65536),
      'supplementary',
      pg_catalog.chr(57344),
      'bmp'
    )
  ) =
    'sha256:' ||
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          '{"n":0.0000001,"' ||
          pg_catalog.chr(65536) ||
          '":"supplementary","' ||
          pg_catalog.chr(57344) ||
          '":"bmp"}',
          'UTF8'
        )
      ),
      'hex'
    ),
  'Runtime canonical hash 必须由数据库 canonical bytes 独立生成'
);

select test_support.assert_true(
  app_data_agent.runtime_canonical_sha256(
    '{
      "schema_version":"1.0.0",
      "event_id":"00000000-0000-4000-8000-00000000e2ff",
      "scope":{
        "app_id":"00000000-0000-4000-8000-00000000da01",
        "tenant_id":"00000000-0000-4000-8000-00000000aa11",
        "environment":"test"
      },
      "run_id":"00000000-0000-4000-8000-00000000a2ff",
      "sequence":1,
      "worker_fence":0,
      "idempotency_key":"event:00000000-0000-4000-8000-00000000e2ff",
      "occurred_at":"2026-07-25T18:00:00.123Z",
      "event_type":"run.accepted",
      "payload":{
        "command_id":"00000000-0000-4000-8000-00000000c2ff",
        "payload_hash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    }'::jsonb
  ) = 'sha256:452420c7a4117f7ccc5947b90c4141eb1e4b3722aed5dbaeef16decc33dd6054',
  'Runtime canonical hash 的固定数据库 golden 不得漂移'
);

select test_support.assert_true(
  (
    select
      event.event_type = 'run.accepted'
      and event.worker_fence = 0
      and event.sequence = 1
      and event.dedupe_key = 'event:' || event.event_id::text
      and event.payload_json = pg_catalog.jsonb_build_object(
        'command_id',
        command.command_id,
        'payload_hash',
        command.payload_hash
      )
      and event.event_document ->> 'schema_version' = '1.0.0'
      and event.event_document ->> 'event_id' = event.event_id::text
      and event.event_document ->> 'run_id' = event.run_id::text
      and event.event_document ->> 'event_type' = 'run.accepted'
      and event.event_document -> 'payload' = event.payload_json
      and event.event_document ->> 'occurred_at'
        ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
      and event.event_hash =
        app_data_agent.runtime_canonical_sha256(event.event_document)
      and projection.projection_hash =
        app_data_agent.runtime_canonical_sha256(projection.projection_json)
      and projection.projection_json = pg_catalog.jsonb_build_object(
        'schema_version',
        '1.0.0',
        'scope',
        event.event_document -> 'scope',
        'run_id',
        event.run_id,
        'status',
        'QUEUED',
        'version',
        1,
        'worker_fence',
        0,
        'attempt_count',
        0,
        'last_event_id',
        event.event_id,
        'last_occurred_at',
        event.event_document -> 'occurred_at',
        'active_artifact_ref',
        null,
        'active_snapshot_ref',
        null,
        'last_side_effect_receipt_id',
        null,
        'terminal_event_id',
        null
      )
    from app_data_agent.run_events as event
    join app_data_agent.commands as command
      on command.app_id = event.app_id
     and command.tenant_id = event.tenant_id
     and command.environment = event.environment
     and command.run_id = event.run_id
    join app_data_agent.run_projections as projection
      on projection.app_id = event.app_id
     and projection.tenant_id = event.tenant_id
     and projection.environment = event.environment
     and projection.run_id = event.run_id
     and projection.version = 1
    where event.run_id = '00000000-0000-4000-8000-00000000a240'::uuid
      and command.command_id =
        '00000000-0000-4000-8000-00000000c240'::uuid
  ),
  'Browser RPC 必须在数据库边界生成可由 TypeScript strict schema 重放的 run.accepted'
);
