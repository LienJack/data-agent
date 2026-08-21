create function app_data_agent.legacy_attribution_cleanup_inventory(requested_deployment_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare
  scope record; target text; target_oid oid; target_count bigint; schema_document jsonb;
  targets jsonb:='[]'::jsonb; inventory jsonb; external_fks integer; hold_columns integer;
  contribution_checksum text; published_f9_checksum text; system_id text;
begin
  select mapping.app_id,mapping.environment into scope
  from platform.deployment_mappings mapping
  join platform.app_environment_lifecycle lifecycle
    on lifecycle.app_id=mapping.app_id and lifecycle.environment=mapping.environment
  where mapping.deployment_id=requested_deployment_id and mapping.is_active
    and mapping.revoked_at is null and lifecycle.lifecycle_state='ACTIVE';
  if not found or scope.app_id<>'00000000-0000-4000-8000-00000000da01'::uuid then
    raise exception using errcode='42501',message='LEGACY_ATTRIBUTION_CLEANUP_DEPLOYMENT_INVALID';
  end if;
  select control.system_identifier::text into system_id from pg_catalog.pg_control_system() control;
  select ledger.migration_checksum into contribution_checksum from platform.migration_ledger ledger
  where ledger.owner_kind='app' and ledger.app_id=scope.app_id
    and ledger.migration_version='20260725010620_app_data_agent_contribution_authority';
  select ledger.migration_checksum into published_f9_checksum from platform.migration_ledger ledger
  where ledger.owner_kind='app' and ledger.app_id=scope.app_id
    and ledger.migration_version='20260725010621_app_data_agent_published_f9';
  if contribution_checksum<>'sha256:c2403b07f7cba81cfce9d4f4ed1aa7ffef636e14eb606f47906dbadf8452bc19'
    or published_f9_checksum<>'sha256:0000000000000000000000000000000000000000000000000000000000000000'
  then raise exception using errcode='P0001',message='LEGACY_ATTRIBUTION_MIGRATION_ATTESTATION_INVALID'; end if;

  foreach target in array app_data_agent.legacy_attribution_cleanup_target_tables() loop
    target_oid:=pg_catalog.to_regclass('app_data_agent.'||target);
    if target_oid is null then
      raise exception using errcode='P0001',message='LEGACY_ATTRIBUTION_CLEANUP_TARGET_MISSING';
    end if;
    execute pg_catalog.format('select pg_catalog.count(*) from app_data_agent.%I',target)
      into target_count;
    select pg_catalog.jsonb_build_object(
      'columns',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'name',attribute.attname,'type',pg_catalog.format_type(attribute.atttypid,attribute.atttypmod),
        'not_null',attribute.attnotnull,'default',pg_catalog.pg_get_expr(default_value.adbin,default_value.adrelid)
      ) order by attribute.attnum)
      from pg_catalog.pg_attribute attribute
      left join pg_catalog.pg_attrdef default_value
        on default_value.adrelid=attribute.attrelid and default_value.adnum=attribute.attnum
      where attribute.attrelid=target_oid and attribute.attnum>0 and not attribute.attisdropped),'[]'::jsonb),
      'constraints',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'name',constraint_row.conname,'type',constraint_row.contype,
        'definition',pg_catalog.pg_get_constraintdef(constraint_row.oid,true)
      ) order by constraint_row.conname) from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid=target_oid),'[]'::jsonb),
      'rls',relation.relrowsecurity,'force_rls',relation.relforcerowsecurity
    ) into schema_document from pg_catalog.pg_class relation where relation.oid=target_oid;
    targets:=targets||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'table_name',target,'row_count',target_count,
      'schema_fingerprint',platform.canonical_sha256(schema_document)));
  end loop;

  select pg_catalog.count(*)::integer into external_fks from pg_catalog.pg_constraint constraint_row
  where constraint_row.contype='f' and (
    (constraint_row.conrelid=any(array(select pg_catalog.to_regclass('app_data_agent.'||name)
      from pg_catalog.unnest(app_data_agent.legacy_attribution_cleanup_target_tables()) name))
      and not constraint_row.confrelid=any(array(select pg_catalog.to_regclass('app_data_agent.'||name)
        from pg_catalog.unnest(app_data_agent.legacy_attribution_cleanup_target_tables()) name)))
    or
    (constraint_row.confrelid=any(array(select pg_catalog.to_regclass('app_data_agent.'||name)
      from pg_catalog.unnest(app_data_agent.legacy_attribution_cleanup_target_tables()) name))
      and not constraint_row.conrelid=any(array(select pg_catalog.to_regclass('app_data_agent.'||name)
        from pg_catalog.unnest(app_data_agent.legacy_attribution_cleanup_target_tables()) name)))
  );
  select pg_catalog.count(*)::integer into hold_columns
  from pg_catalog.pg_attribute attribute where attribute.attnum>0 and not attribute.attisdropped
    and attribute.attrelid=any(array(select pg_catalog.to_regclass('app_data_agent.'||name)
      from pg_catalog.unnest(app_data_agent.legacy_attribution_cleanup_target_tables()) name))
    and attribute.attname~*'hold';

  inventory:=pg_catalog.jsonb_build_object(
    'schema_version','legacy-attribution-cleanup-inventory@1.0.0',
    'app_id',scope.app_id,'environment',scope.environment,'deployment_id',requested_deployment_id,
    'database_name',pg_catalog.current_database(),'system_identifier',system_id,
    'migration_attestation',pg_catalog.jsonb_build_object(
      'contribution_10620_ledger_checksum',contribution_checksum,
      'published_f9_10621_legacy_ledger_checksum',published_f9_checksum,
      'published_f9_10621_source_checksum','sha256:2d86b6622d4009169137716e398cc54f495d83114b69877ca2dbbc6b9049d26e',
      'published_f9_legacy_zero_ledger_attested',true),
    'targets',targets,'external_fk_count',external_fks,'hold_column_count',hold_columns,
    'total_rows',(select coalesce(pg_catalog.sum((entry->>'row_count')::bigint),0)
      from pg_catalog.jsonb_array_elements(targets) entry));
  return inventory||pg_catalog.jsonb_build_object('inventory_digest',platform.canonical_sha256(inventory));
end
$function$;

create function app_data_agent.execute_legacy_attribution_cleanup(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare
  now_at timestamptz:=pg_catalog.clock_timestamp(); operation uuid; request_hash text;
  existing record; inventory jsonb; after_inventory jsonb; expected_counts jsonb; actual_counts jsonb;
  deleted_counts jsonb:='{}'::jsonb; after_counts jsonb; target text; removed bigint; total_deleted bigint:=0;
  backup_created_at timestamptz; terminal text; reason_code text; receipt jsonb; receipt_hash text;
begin
  if session_user<>'postgres' then
    raise exception using errcode='42501',message='LEGACY_ATTRIBUTION_CLEANUP_EXECUTOR_UNSAFE';
  end if;
  if command is null or pg_catalog.jsonb_typeof(command)<>'object'
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command))<>15
    or not command ?& array['schema_version','operation_id','deployment_id','app_id','environment',
      'database_name','system_identifier','inventory_digest','backup','approval','expected_counts',
      'expected_total','hold_attestation','retirement_commit','requested_at']
    or command->>'schema_version'<>'legacy-attribution-cleanup-command@1.0.0'
    or command->>'approval'<>'DELETE_LEGACY_ATTRIBUTION_AUTHORITY_ROWS_ONLY'
    or command->>'hold_attestation'<>'NO_HOLDS'
    or command->>'operation_id'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or command->>'deployment_id'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or command->>'app_id'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or command->>'inventory_digest'!~'^sha256:[0-9a-f]{64}$'
    or command->>'retirement_commit'!~'^[0-9a-f]{7,40}$'
    or pg_catalog.jsonb_typeof(command->'expected_counts')<>'object'
    or pg_catalog.jsonb_typeof(command->'expected_total')<>'number'
    or (command->>'expected_total')!~'^(0|[1-9][0-9]*)$'
    or pg_catalog.jsonb_typeof(command->'backup')<>'object'
    or pg_catalog.jsonb_typeof(command->'requested_at')<>'string'
  then raise exception using errcode='22023',message='LEGACY_ATTRIBUTION_CLEANUP_COMMAND_INVALID'; end if;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command->'backup'))<>8
    or not (command->'backup') ?& array['schema_version','database_name','system_identifier',
      'inventory_digest','backup_sha256','backup_bytes','restore_list_verified','created_at']
    or command#>>'{backup,schema_version}'<>'legacy-attribution-backup-manifest@1.0.0'
    or command#>>'{backup,backup_sha256}'!~'^sha256:[0-9a-f]{64}$'
    or command#>>'{backup,restore_list_verified}'<>'true'
    or pg_catalog.jsonb_typeof(command#>'{backup,backup_bytes}')<>'number'
    or (command#>>'{backup,backup_bytes}')!~'^[1-9][0-9]*$'
  then raise exception using errcode='22023',message='LEGACY_ATTRIBUTION_CLEANUP_BACKUP_INVALID'; end if;
  begin
    operation:=(command->>'operation_id')::uuid;
    backup_created_at:=(command#>>'{backup,created_at}')::timestamptz;
    perform (command->>'requested_at')::timestamptz;
  exception when others then
    raise exception using errcode='22023',message='LEGACY_ATTRIBUTION_CLEANUP_COMMAND_INVALID';
  end;
  if backup_created_at<now_at-pg_catalog.make_interval(hours=>24)
    or backup_created_at>now_at+pg_catalog.make_interval(mins=>5)
  then raise exception using errcode='22023',message='LEGACY_ATTRIBUTION_CLEANUP_BACKUP_STALE'; end if;
  request_hash:=platform.canonical_sha256(command);
  select receipt.request_hash,receipt.receipt_document into existing
  from app_data_agent.legacy_attribution_cleanup_receipts receipt
  where receipt.operation_id=operation;
  if found then
    if existing.request_hash<>request_hash then
      raise exception using errcode='P0001',message='LEGACY_ATTRIBUTION_CLEANUP_OPERATION_CONFLICT';
    end if;
    return existing.receipt_document;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:legacy-attribution-cleanup:'||(command->>'app_id')||':'||(command->>'environment'),0));
  foreach target in array app_data_agent.legacy_attribution_cleanup_target_tables() loop
    execute pg_catalog.format('lock table app_data_agent.%I in access exclusive mode',target);
  end loop;
  inventory:=app_data_agent.legacy_attribution_cleanup_inventory((command->>'deployment_id')::uuid);
  select pg_catalog.jsonb_object_agg(entry->>'table_name',(entry->>'row_count')::bigint order by entry->>'table_name')
    into actual_counts from pg_catalog.jsonb_array_elements(inventory->'targets') entry;
  expected_counts:=command->'expected_counts';
  if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(expected_counts))<>12
    or not expected_counts ?& app_data_agent.legacy_attribution_cleanup_target_tables()
    or inventory->>'app_id'<>command->>'app_id'
    or inventory->>'environment'<>command->>'environment'
    or inventory->>'database_name'<>command->>'database_name'
    or inventory->>'system_identifier'<>command->>'system_identifier'
    or inventory->>'inventory_digest'<>command->>'inventory_digest'
    or command#>>'{backup,database_name}'<>inventory->>'database_name'
    or command#>>'{backup,system_identifier}'<>inventory->>'system_identifier'
    or command#>>'{backup,inventory_digest}'<>inventory->>'inventory_digest'
    or expected_counts<>actual_counts
    or (command->>'expected_total')::bigint<>(inventory->>'total_rows')::bigint
    or (inventory->>'external_fk_count')::integer<>0
    or (inventory->>'hold_column_count')::integer<>0
  then raise exception using errcode='P0001',message='LEGACY_ATTRIBUTION_CLEANUP_PREFLIGHT_MISMATCH'; end if;

  foreach target in array app_data_agent.legacy_attribution_cleanup_target_tables() loop
    execute pg_catalog.format('delete from app_data_agent.%I',target);
    get diagnostics removed=row_count;
    deleted_counts:=deleted_counts||pg_catalog.jsonb_build_object(target,removed);
    total_deleted:=total_deleted+removed;
  end loop;
  after_inventory:=app_data_agent.legacy_attribution_cleanup_inventory((command->>'deployment_id')::uuid);
  if (after_inventory->>'total_rows')::bigint<>0 then
    raise exception using errcode='P0001',message='LEGACY_ATTRIBUTION_CLEANUP_POSTCONDITION_FAILED';
  end if;
  select pg_catalog.jsonb_object_agg(entry->>'table_name',(entry->>'row_count')::bigint order by entry->>'table_name')
    into after_counts from pg_catalog.jsonb_array_elements(after_inventory->'targets') entry;
  terminal:=case when total_deleted=0 then 'NOOP' else 'COMPLETED' end;
  reason_code:=case when total_deleted=0 then 'LEGACY_ATTRIBUTION_NO_ROWS_FOUND'
    else 'LEGACY_ATTRIBUTION_AUTHORITY_ROWS_DELETED' end;
  receipt:=pg_catalog.jsonb_build_object(
    'schema_version','legacy-attribution-cleanup-receipt@1.0.0','operation_id',operation,
    'app_id',command->>'app_id','environment',command->>'environment',
    'database_name',command->>'database_name','system_identifier',command->>'system_identifier',
    'inventory_digest',command->>'inventory_digest','backup_sha256',command#>>'{backup,backup_sha256}',
    'before_counts',actual_counts,'deleted_counts',deleted_counts,'after_counts',after_counts,
    'total_deleted',total_deleted,'terminal',terminal,'reason_code',reason_code,'executed_at',now_at);
  receipt_hash:=platform.canonical_sha256(receipt);
  receipt:=receipt||pg_catalog.jsonb_build_object('receipt_hash',receipt_hash);
  insert into app_data_agent.legacy_attribution_cleanup_receipts(
    operation_id,app_id,environment,database_name,system_identifier,inventory_digest,backup_sha256,
    terminal,reason_code,total_deleted,request_document,request_hash,receipt_document,receipt_hash,executed_at)
  values(operation,(command->>'app_id')::uuid,command->>'environment',command->>'database_name',
    command->>'system_identifier',command->>'inventory_digest',command#>>'{backup,backup_sha256}',
    terminal,reason_code,total_deleted,command,request_hash,receipt,receipt_hash,now_at);
  return receipt;
end
$function$;
