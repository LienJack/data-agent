begin;

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010400_app_data_agent_egress',
  'sha256:d435213aac912abd138125984a3c1e07f28325c5909504c9e5615189e83369cd'
);

create table app_data_agent.datasource_egress_policies (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  policy_id uuid not null,
  datasource_id text not null
    check (datasource_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'),
  created_by uuid not null,
  version bigint not null default 1 check (version >= 1),
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'REVOKED')),
  allowed_hosts text[] not null
    check (
      pg_catalog.cardinality(allowed_hosts) between 1 and 64
      and pg_catalog.array_position(allowed_hosts, null) is null
    ),
  allowed_ports integer[] not null
    check (
      pg_catalog.cardinality(allowed_ports) between 1 and 32
      and pg_catalog.array_position(allowed_ports, null) is null
    ),
  allowed_protocols text[] not null
    check (
      pg_catalog.cardinality(allowed_protocols) between 1 and 3
      and pg_catalog.array_position(allowed_protocols, null) is null
    ),
  allowed_roles text[] not null
    check (
      pg_catalog.cardinality(allowed_roles) between 1 and 2
      and pg_catalog.array_position(allowed_roles, null) is null
    ),
  revoked_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, policy_id),
  foreign key (app_id, tenant_id, environment, created_by)
    references app_data_agent.memberships (
      app_id,
      tenant_id,
      environment,
      principal_id
    )
    on delete restrict,
  check (
    (status = 'REVOKED' and revoked_at is not null)
    or (status = 'ACTIVE' and revoked_at is null)
  )
);

create unique index datasource_egress_policies_active_datasource
on app_data_agent.datasource_egress_policies (
  app_id,
  tenant_id,
  environment,
  datasource_id
)
where status = 'ACTIVE';

create table app_data_agent.datasource_egress_approvals (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  approval_id uuid not null,
  policy_id uuid not null,
  policy_version bigint not null check (policy_version >= 1),
  requested_by uuid not null,
  requested_url text not null
    check (pg_catalog.length(requested_url) between 1 and 2000),
  requested_host text not null
    check (
      requested_host ~
        '^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$'
    ),
  requested_port integer not null check (requested_port between 1 and 65535),
  requested_protocol text not null
    check (requested_protocol in ('https:', 'http:', 'postgresql:')),
  pinned_addresses inet[] not null
    check (
      pg_catalog.cardinality(pinned_addresses) between 1 and 16
      and pg_catalog.array_position(pinned_addresses, null) is null
    ),
  status text not null default 'PINNED'
    check (status in ('PINNED', 'VERIFIED', 'CONSUMED')),
  expires_at timestamptz not null,
  verified_at timestamptz,
  target_expires_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, approval_id),
  foreign key (app_id, tenant_id, environment, policy_id)
    references app_data_agent.datasource_egress_policies (
      app_id,
      tenant_id,
      environment,
      policy_id
    )
    on delete restrict,
  foreign key (app_id, tenant_id, environment, requested_by)
    references app_data_agent.memberships (
      app_id,
      tenant_id,
      environment,
      principal_id
    )
    on delete restrict,
  check (
    (
      status = 'PINNED'
      and verified_at is null
      and target_expires_at is null
      and consumed_at is null
    )
    or (
      status = 'VERIFIED'
      and verified_at is not null
      and target_expires_at is not null
      and consumed_at is null
    )
    or (
      status = 'CONSUMED'
      and verified_at is not null
      and target_expires_at is not null
      and consumed_at is not null
    )
  )
);

create index datasource_egress_approvals_expiry
on app_data_agent.datasource_egress_approvals (
  app_id,
  tenant_id,
  environment,
  status,
  expires_at
);

create or replace function app_data_agent.guard_datasource_egress_policy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = 'P0001',
      message = 'DA_DATASOURCE_POLICY_IMMUTABLE';
  end if;
  if (
    old.status = 'ACTIVE'
    and new.status = 'REVOKED'
    and new.version = old.version + 1
    and new.revoked_at is not null
    and new.updated_at >= old.updated_at
    and (pg_catalog.to_jsonb(new) - array['status', 'version', 'revoked_at', 'updated_at'])
      = (pg_catalog.to_jsonb(old) - array['status', 'version', 'revoked_at', 'updated_at'])
  ) then
    return new;
  end if;
  raise exception using
    errcode = 'P0001',
    message = 'DA_DATASOURCE_POLICY_TRANSITION_INVALID';
end
$$;

create trigger datasource_egress_policy_guard
before update or delete on app_data_agent.datasource_egress_policies
for each row execute function app_data_agent.guard_datasource_egress_policy();

create or replace function app_data_agent.guard_datasource_egress_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = 'P0001',
      message = 'DA_DATASOURCE_APPROVAL_IMMUTABLE';
  end if;
  if (
    old.status = 'PINNED'
    and new.status = 'VERIFIED'
    and new.verified_at is not null
    and new.target_expires_at is not null
    and new.consumed_at is null
    and new.updated_at >= old.updated_at
    and (pg_catalog.to_jsonb(new)
      - array['status', 'verified_at', 'target_expires_at', 'updated_at'])
      = (pg_catalog.to_jsonb(old)
        - array['status', 'verified_at', 'target_expires_at', 'updated_at'])
  ) then
    return new;
  end if;
  if (
    old.status = 'VERIFIED'
    and new.status = 'CONSUMED'
    and new.consumed_at is not null
    and new.updated_at >= old.updated_at
    and (pg_catalog.to_jsonb(new) - array['status', 'consumed_at', 'updated_at'])
      = (pg_catalog.to_jsonb(old) - array['status', 'consumed_at', 'updated_at'])
  ) then
    return new;
  end if;
  raise exception using
    errcode = 'P0001',
    message = 'DA_DATASOURCE_APPROVAL_TRANSITION_INVALID';
end
$$;

create trigger datasource_egress_approval_guard
before update or delete on app_data_agent.datasource_egress_approvals
for each row execute function app_data_agent.guard_datasource_egress_approval();

create or replace function app_data_agent.is_public_egress_address(
  requested_address inet
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select requested_address is not null
    and pg_catalog.masklen(requested_address) = case pg_catalog.family(requested_address)
      when 4 then 32
      when 6 then 128
      else -1
    end
    and case pg_catalog.family(requested_address)
      when 4 then not (
        requested_address <<= '0.0.0.0/8'::inet
        or requested_address <<= '10.0.0.0/8'::inet
        or requested_address <<= '100.64.0.0/10'::inet
        or requested_address <<= '127.0.0.0/8'::inet
        or requested_address <<= '169.254.0.0/16'::inet
        or requested_address <<= '172.16.0.0/12'::inet
        or requested_address <<= '192.0.0.0/24'::inet
        or requested_address <<= '192.0.2.0/24'::inet
        or requested_address <<= '192.88.99.0/24'::inet
        or requested_address <<= '192.168.0.0/16'::inet
        or requested_address <<= '198.18.0.0/15'::inet
        or requested_address <<= '198.51.100.0/24'::inet
        or requested_address <<= '203.0.113.0/24'::inet
        or requested_address <<= '224.0.0.0/4'::inet
        or requested_address <<= '240.0.0.0/4'::inet
      )
      when 6 then not (
        requested_address <<= '::/128'::inet
        or requested_address <<= '::1/128'::inet
        or requested_address <<= '::ffff:0:0/96'::inet
        or requested_address <<= '64:ff9b::/96'::inet
        or requested_address <<= '64:ff9b:1::/48'::inet
        or requested_address <<= 'fc00::/7'::inet
        or requested_address <<= 'fe80::/10'::inet
        or requested_address <<= '2001::/32'::inet
        or requested_address <<= '2001:db8::/32'::inet
        or requested_address <<= '2002::/16'::inet
        or requested_address <<= 'ff00::/8'::inet
      )
      else false
    end
$$;

create or replace function app_data_agent.register_datasource_egress_policy(
  requested_policy_id uuid,
  requested_datasource_id text,
  requested_allowed_hosts text[],
  requested_allowed_ports integer[],
  requested_allowed_protocols text[],
  requested_allowed_roles text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_authority record;
  registered_policy app_data_agent.datasource_egress_policies%rowtype;
  normalized_hosts text[];
  normalized_ports integer[];
  normalized_protocols text[];
  normalized_roles text[];
begin
  select *
  into current_authority
  from platform.current_backend_authority(true);
  if current_authority.membership_role <> 'owner' then
    raise exception using errcode = '42501', message = 'DA_OWNER_REQUIRED';
  end if;

  select pg_catalog.array_agg(host order by host)
  into normalized_hosts
  from (
    select distinct pg_catalog.lower(value) as host
    from pg_catalog.unnest(requested_allowed_hosts) as value
  ) as values;
  select pg_catalog.array_agg(port order by port)
  into normalized_ports
  from (
    select distinct value as port
    from pg_catalog.unnest(requested_allowed_ports) as value
  ) as values;
  select pg_catalog.array_agg(protocol order by protocol)
  into normalized_protocols
  from (
    select distinct value as protocol
    from pg_catalog.unnest(requested_allowed_protocols) as value
  ) as values;
  select pg_catalog.array_agg(role_name order by role_name)
  into normalized_roles
  from (
    select distinct value as role_name
    from pg_catalog.unnest(requested_allowed_roles) as value
  ) as values;

  if requested_allowed_hosts is null
    or pg_catalog.array_position(requested_allowed_hosts, null) is not null
    or requested_allowed_ports is null
    or pg_catalog.array_position(requested_allowed_ports, null) is not null
    or requested_allowed_protocols is null
    or pg_catalog.array_position(requested_allowed_protocols, null) is not null
    or requested_allowed_roles is null
    or pg_catalog.array_position(requested_allowed_roles, null) is not null
    or requested_datasource_id !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or pg_catalog.cardinality(normalized_hosts) not between 1 and 64
    or exists (
      select 1
      from pg_catalog.unnest(normalized_hosts) as host
      where host !~
        '^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$'
    )
    or pg_catalog.cardinality(normalized_ports) not between 1 and 32
    or exists (
      select 1 from pg_catalog.unnest(normalized_ports) as port
      where port not between 1 and 65535
    )
    or pg_catalog.cardinality(normalized_protocols) not between 1 and 3
    or exists (
      select 1 from pg_catalog.unnest(normalized_protocols) as protocol
      where protocol not in ('https:', 'http:', 'postgresql:')
    )
    or pg_catalog.cardinality(normalized_roles) not between 1 and 2
    or exists (
      select 1 from pg_catalog.unnest(normalized_roles) as role_name
      where role_name not in ('owner', 'analyst')
    )
  then
    raise exception using
      errcode = '22023',
      message = 'DA_DATASOURCE_POLICY_INVALID';
  end if;

  insert into app_data_agent.datasource_egress_policies (
    app_id,
    tenant_id,
    environment,
    policy_id,
    datasource_id,
    created_by,
    allowed_hosts,
    allowed_ports,
    allowed_protocols,
    allowed_roles
  )
  values (
    current_authority.app_id,
    current_authority.tenant_id,
    current_authority.environment,
    requested_policy_id,
    requested_datasource_id,
    current_authority.principal_id,
    normalized_hosts,
    normalized_ports,
    normalized_protocols,
    normalized_roles
  )
  returning * into registered_policy;

  insert into app_data_agent.audit_log (
    app_id, tenant_id, environment, audit_id, principal_id,
    action, resource_type, resource_id, details
  )
  values (
    registered_policy.app_id,
    registered_policy.tenant_id,
    registered_policy.environment,
    pg_catalog.gen_random_uuid(),
    current_authority.principal_id,
    'DATASOURCE_POLICY_REGISTERED',
    'datasource_egress_policy',
    registered_policy.policy_id::text,
    pg_catalog.jsonb_build_object(
      'datasourceId', registered_policy.datasource_id,
      'version', registered_policy.version
    )
  );
  return pg_catalog.to_jsonb(registered_policy);
end
$$;

create or replace function app_data_agent.revoke_datasource_egress_policy(
  requested_policy_id uuid,
  expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_authority record;
  revoked_policy app_data_agent.datasource_egress_policies%rowtype;
begin
  select *
  into current_authority
  from platform.current_backend_authority(true);
  if current_authority.membership_role <> 'owner' then
    raise exception using errcode = '42501', message = 'DA_OWNER_REQUIRED';
  end if;

  update app_data_agent.datasource_egress_policies
  set status = 'REVOKED',
      version = version + 1,
      revoked_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where app_id = current_authority.app_id
    and tenant_id = current_authority.tenant_id
    and environment = current_authority.environment
    and policy_id = requested_policy_id
    and version = expected_version
    and status = 'ACTIVE'
  returning * into revoked_policy;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'DA_DATASOURCE_POLICY_STALE';
  end if;

  insert into app_data_agent.audit_log (
    app_id, tenant_id, environment, audit_id, principal_id,
    action, resource_type, resource_id, details
  )
  values (
    revoked_policy.app_id,
    revoked_policy.tenant_id,
    revoked_policy.environment,
    pg_catalog.gen_random_uuid(),
    current_authority.principal_id,
    'DATASOURCE_POLICY_REVOKED',
    'datasource_egress_policy',
    revoked_policy.policy_id::text,
    pg_catalog.jsonb_build_object('version', revoked_policy.version)
  );
  return pg_catalog.to_jsonb(revoked_policy);
end
$$;

create or replace function app_data_agent.register_datasource_egress_approval(
  requested_approval_id uuid,
  requested_policy_id uuid,
  expected_policy_version bigint,
  requested_url text,
  requested_host text,
  requested_port integer,
  requested_protocol text,
  requested_pinned_addresses inet[],
  requested_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_authority record;
  current_policy app_data_agent.datasource_egress_policies%rowtype;
  registered_approval app_data_agent.datasource_egress_approvals%rowtype;
  normalized_addresses inet[];
  authority_segment text;
  url_parts text[];
  url_protocol text;
  url_host text;
  url_port integer;
begin
  select *
  into current_authority
  from platform.current_backend_authority(true);
  select policy.*
  into current_policy
  from app_data_agent.datasource_egress_policies as policy
  where policy.app_id = current_authority.app_id
    and policy.tenant_id = current_authority.tenant_id
    and policy.environment = current_authority.environment
    and policy.policy_id = requested_policy_id
    and policy.version = expected_policy_version
    and policy.status = 'ACTIVE';
  if not found
    or (current_authority.membership_role = any(current_policy.allowed_roles)) is not true
    or (pg_catalog.lower(requested_host) = any(current_policy.allowed_hosts)) is not true
    or (requested_port = any(current_policy.allowed_ports)) is not true
    or (requested_protocol = any(current_policy.allowed_protocols)) is not true
  then
    raise exception using
      errcode = '42501',
      message = 'DA_DATASOURCE_POLICY_FORBIDDEN';
  end if;

  select pg_catalog.array_agg(address order by address::text)
  into normalized_addresses
  from (
    select distinct value as address
    from pg_catalog.unnest(requested_pinned_addresses) as value
  ) as values;
  url_parts := pg_catalog.regexp_match(
    requested_url,
    '^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^\/?#]+)([\/?#].*)?$'
  );
  if url_parts is not null then
    url_protocol := pg_catalog.lower(url_parts[1]) || ':';
    authority_segment := url_parts[2];
    if pg_catalog.strpos(authority_segment, ':') = 0 then
      url_host := pg_catalog.lower(authority_segment);
      url_port := case url_protocol
        when 'https:' then 443
        when 'http:' then 80
        when 'postgresql:' then 5432
        else null
      end;
    elsif authority_segment ~ '^[^:]+:[0-9]{1,5}$' then
      url_host := pg_catalog.lower(pg_catalog.split_part(authority_segment, ':', 1));
      url_port := pg_catalog.split_part(authority_segment, ':', 2)::integer;
    end if;
  end if;
  if pg_catalog.length(requested_url) not between 1 and 2000
    or requested_url ~ '[[:cntrl:]]'
    or pg_catalog.strpos(requested_url, '?') <> 0
    or pg_catalog.strpos(requested_url, '#') <> 0
    or url_parts is null
    or coalesce(url_parts[3], '/') <> '/'
    or pg_catalog.strpos(authority_segment, '@') <> 0
    or url_protocol is distinct from requested_protocol
    or url_host is distinct from pg_catalog.lower(requested_host)
    or url_port is distinct from requested_port
    or pg_catalog.cardinality(normalized_addresses) not between 1 and 16
    or exists (
      select 1
      from pg_catalog.unnest(normalized_addresses) as address
      where not app_data_agent.is_public_egress_address(address)
    )
    or requested_expires_at <= pg_catalog.clock_timestamp()
    or requested_expires_at >
      pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => 60)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_DATASOURCE_APPROVAL_INVALID';
  end if;

  insert into app_data_agent.datasource_egress_approvals (
    app_id,
    tenant_id,
    environment,
    approval_id,
    policy_id,
    policy_version,
    requested_by,
    requested_url,
    requested_host,
    requested_port,
    requested_protocol,
    pinned_addresses,
    expires_at
  )
  values (
    current_authority.app_id,
    current_authority.tenant_id,
    current_authority.environment,
    requested_approval_id,
    current_policy.policy_id,
    current_policy.version,
    current_authority.principal_id,
    requested_url,
    pg_catalog.lower(requested_host),
    requested_port,
    requested_protocol,
    normalized_addresses,
    requested_expires_at
  )
  returning * into registered_approval;
  return pg_catalog.to_jsonb(registered_approval);
end
$$;

create or replace function app_data_agent.verify_datasource_egress_approval(
  requested_approval_id uuid,
  expected_policy_version bigint,
  requested_revalidated_addresses inet[],
  requested_target_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_authority record;
  current_approval app_data_agent.datasource_egress_approvals%rowtype;
  normalized_addresses inet[];
begin
  select *
  into current_authority
  from platform.current_backend_authority(true);
  select approval.*
  into current_approval
  from app_data_agent.datasource_egress_approvals as approval
  join app_data_agent.datasource_egress_policies as policy
    on policy.app_id = approval.app_id
   and policy.tenant_id = approval.tenant_id
   and policy.environment = approval.environment
   and policy.policy_id = approval.policy_id
  where approval.app_id = current_authority.app_id
    and approval.tenant_id = current_authority.tenant_id
    and approval.environment = current_authority.environment
    and approval.approval_id = requested_approval_id
    and approval.requested_by = current_authority.principal_id
    and approval.policy_version = expected_policy_version
    and approval.status = 'PINNED'
    and approval.expires_at > pg_catalog.clock_timestamp()
    and policy.status = 'ACTIVE'
    and policy.version = approval.policy_version
  for update of approval, policy;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'DA_DATASOURCE_APPROVAL_STALE';
  end if;

  select pg_catalog.array_agg(address order by address::text)
  into normalized_addresses
  from (
    select distinct value as address
    from pg_catalog.unnest(requested_revalidated_addresses) as value
  ) as values;
  if normalized_addresses is distinct from current_approval.pinned_addresses
    or requested_target_expires_at <= pg_catalog.clock_timestamp()
    or requested_target_expires_at >
      pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => 10)
    or requested_target_expires_at > current_approval.expires_at
  then
    raise exception using
      errcode = '42501',
      message = 'DA_DATASOURCE_DNS_REBIND';
  end if;

  update app_data_agent.datasource_egress_approvals
  set status = 'VERIFIED',
      verified_at = pg_catalog.clock_timestamp(),
      target_expires_at = requested_target_expires_at,
      updated_at = pg_catalog.clock_timestamp()
  where app_id = current_approval.app_id
    and tenant_id = current_approval.tenant_id
    and environment = current_approval.environment
    and approval_id = current_approval.approval_id
    and status = 'PINNED'
    and expires_at > pg_catalog.clock_timestamp()
    and requested_target_expires_at > pg_catalog.clock_timestamp()
  returning * into current_approval;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'DA_DATASOURCE_APPROVAL_STALE';
  end if;
  return pg_catalog.to_jsonb(current_approval);
end
$$;

create or replace function app_data_agent.consume_datasource_egress_approval(
  requested_approval_id uuid,
  expected_policy_version bigint,
  requested_selected_address inet
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_authority record;
  current_approval app_data_agent.datasource_egress_approvals%rowtype;
begin
  select *
  into current_authority
  from platform.current_backend_authority(true);
  select approval.*
  into current_approval
  from app_data_agent.datasource_egress_approvals as approval
  join app_data_agent.datasource_egress_policies as policy
    on policy.app_id = approval.app_id
   and policy.tenant_id = approval.tenant_id
   and policy.environment = approval.environment
   and policy.policy_id = approval.policy_id
  where approval.app_id = current_authority.app_id
    and approval.tenant_id = current_authority.tenant_id
    and approval.environment = current_authority.environment
    and approval.approval_id = requested_approval_id
    and approval.requested_by = current_authority.principal_id
    and approval.policy_version = expected_policy_version
    and approval.status = 'VERIFIED'
    and approval.expires_at > pg_catalog.clock_timestamp()
    and approval.target_expires_at > pg_catalog.clock_timestamp()
    and policy.status = 'ACTIVE'
    and policy.version = approval.policy_version
    and requested_selected_address = any(approval.pinned_addresses)
  for update of approval, policy;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'DA_DATASOURCE_APPROVAL_STALE';
  end if;

  update app_data_agent.datasource_egress_approvals
  set status = 'CONSUMED',
      consumed_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where app_id = current_approval.app_id
    and tenant_id = current_approval.tenant_id
    and environment = current_approval.environment
    and approval_id = current_approval.approval_id
    and status = 'VERIFIED'
    and expires_at > pg_catalog.clock_timestamp()
    and target_expires_at > pg_catalog.clock_timestamp()
  returning * into current_approval;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'DA_DATASOURCE_APPROVAL_STALE';
  end if;

  insert into app_data_agent.audit_log (
    app_id, tenant_id, environment, audit_id, principal_id,
    action, resource_type, resource_id, details
  )
  values (
    current_approval.app_id,
    current_approval.tenant_id,
    current_approval.environment,
    pg_catalog.gen_random_uuid(),
    current_authority.principal_id,
    'DATASOURCE_EGRESS_CONSUMED',
    'datasource_egress_approval',
    current_approval.approval_id::text,
    pg_catalog.jsonb_build_object(
      'policyId', current_approval.policy_id,
      'policyVersion', current_approval.policy_version,
      'selectedAddressHash',
      platform.canonical_sha256(pg_catalog.to_jsonb(requested_selected_address::text))
    )
  );
  return pg_catalog.to_jsonb(current_approval);
end
$$;

alter table app_data_agent.datasource_egress_policies enable row level security;
alter table app_data_agent.datasource_egress_policies force row level security;
alter table app_data_agent.datasource_egress_approvals enable row level security;
alter table app_data_agent.datasource_egress_approvals force row level security;

create policy datasource_egress_policies_backend_select
on app_data_agent.datasource_egress_policies
for select
to data_agent_backend
using (platform.backend_context_matches(app_id, tenant_id, environment, false));

create policy datasource_egress_approvals_backend_select
on app_data_agent.datasource_egress_approvals
for select
to data_agent_backend
using (
  platform.backend_principal_object_matches(
    app_id,
    tenant_id,
    environment,
    requested_by,
    false
  )
);

revoke all privileges on table
  app_data_agent.datasource_egress_policies,
  app_data_agent.datasource_egress_approvals
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;
grant select on table
  app_data_agent.datasource_egress_policies,
  app_data_agent.datasource_egress_approvals
to data_agent_backend;

revoke all privileges on function app_data_agent.is_public_egress_address(inet)
from public, anon, authenticated, service_role;
revoke all privileges on function app_data_agent.register_datasource_egress_policy(
  uuid, text, text[], integer[], text[], text[]
) from public, anon, authenticated, service_role, data_agent_backend;
revoke all privileges on function app_data_agent.revoke_datasource_egress_policy(uuid, bigint)
from public, anon, authenticated, service_role, data_agent_backend;
revoke all privileges on function app_data_agent.register_datasource_egress_approval(
  uuid, uuid, bigint, text, text, integer, text, inet[], timestamptz
) from public, anon, authenticated, service_role, data_agent_backend;
revoke all privileges on function app_data_agent.verify_datasource_egress_approval(
  uuid, bigint, inet[], timestamptz
) from public, anon, authenticated, service_role, data_agent_backend;
revoke all privileges on function app_data_agent.consume_datasource_egress_approval(
  uuid, bigint, inet
) from public, anon, authenticated, service_role, data_agent_backend;

grant execute on function app_data_agent.register_datasource_egress_policy(
  uuid, text, text[], integer[], text[], text[]
) to data_agent_backend;
grant execute on function app_data_agent.revoke_datasource_egress_policy(uuid, bigint)
to data_agent_backend;
grant execute on function app_data_agent.register_datasource_egress_approval(
  uuid, uuid, bigint, text, text, integer, text, inet[], timestamptz
) to data_agent_backend;
grant execute on function app_data_agent.verify_datasource_egress_approval(
  uuid, bigint, inet[], timestamptz
) to data_agent_backend;
grant execute on function app_data_agent.consume_datasource_egress_approval(
  uuid, bigint, inet
) to data_agent_backend;

commit;
