\set ON_ERROR_STOP on

do $surface$
declare relation_name text; function_definition text;
begin
  if not exists (
    select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010660_app_data_agent_workspace_files'
  ) then raise exception 'WORKSPACE_FILES_LEDGER_MISSING'; end if;
  foreach relation_name in array array[
    'storage_retention_policy_revisions','workspace_content_blobs','workspace_files',
    'workspace_file_revisions','workspace_file_scan_receipts','workspace_file_deletion_receipts',
    'workspace_file_legal_holds','workspace_content_gc_receipts','workspace_file_idempotency'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='app_data_agent' and relation.relname=relation_name
        and relation.relrowsecurity and relation.relforcerowsecurity
        and relation.relowner=(select oid from pg_catalog.pg_roles where rolname='data_agent_u6_file_owner')
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend',pg_catalog.format('app_data_agent.%I',relation_name),'SELECT,INSERT,UPDATE,DELETE'
    ) then raise exception 'WORKSPACE_FILES_RELATION_SURFACE_INVALID:%',relation_name; end if;
  end loop;
  if exists (
    select 1 from pg_catalog.pg_roles where rolname='data_agent_u6_file_owner'
      and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolinherit or rolbypassrls)
  ) then raise exception 'WORKSPACE_FILES_OWNER_UNSAFE'; end if;
  if not exists (
    select 1 from app_data_agent.job_handler_revisions
    where kind='FILE_SCAN' and handler_revision='file-scan-handler@1.0.0'
      and enabled and dependencies_ready and output_receipt_required
  ) then raise exception 'WORKSPACE_FILES_HANDLER_MISSING'; end if;
  if pg_catalog.to_regprocedure('app_data_agent.commit_workspace_file_upload(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.resolve_workspace_file_download(uuid,bigint,text)') is null
    or pg_catalog.to_regprocedure('app_data_agent.promote_workspace_file(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.delete_workspace_file(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.load_workspace_file_for_scan(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.commit_workspace_file_scan(jsonb,jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.update_storage_retention_policy(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.evaluate_workspace_content_gc(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.commit_workspace_content_gc(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.classify_workspace_content_orphan(jsonb)') is null
  then raise exception 'WORKSPACE_FILES_RPC_SURFACE_INCOMPLETE'; end if;
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict function_definition
  from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
  where namespace.nspname='app_data_agent' and procedure.proname='build_requested_optional_resource_bindings';
  if function_definition not like '%workspace_file_revisions%'
    or function_definition not like '%status=''READY''%'
    or function_definition not like '%RESOURCE_NOT_FOUND_OR_FORBIDDEN%'
  then raise exception 'WORKSPACE_FILES_EFFECTIVE_CONFIG_RESOLVER_MISSING'; end if;
end
$surface$;

begin;
insert into app_data_agent.workspaces(app_id,workspace_id,environment,slug,display_name)
values ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000006601',
  'local','u6-files-smoke','U6 Files smoke');
insert into app_data_agent.memberships(
  app_id,tenant_id,environment,principal_id,membership_role,workspace_role,membership_source
) values ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000006601',
  'local','00000000-0000-4000-8000-000000006602','owner','WORKSPACE_ADMIN','EXPLICIT');
insert into data_agent_auth."user"("id","name","email","emailVerified","username","displayUsername")
values ('00000000-0000-4000-8000-000000006602','U6 fixture','u6-fixture@example.invalid',true,
  'u6_fixture','u6_fixture');
insert into app_data_agent.app_users(
  app_id,environment,principal_id,auth_user_id,email,display_name,system_role
) values ('00000000-0000-4000-8000-00000000da01','local',
  '00000000-0000-4000-8000-000000006602','00000000-0000-4000-8000-000000006602',
  'u6-fixture@example.invalid','U6 fixture','USER');
do $policy$
declare document jsonb; created timestamptz:=pg_catalog.clock_timestamp();
begin
  document:=pg_catalog.jsonb_build_object(
    'schema_version','storage-retention-policy-revision@1.0.0',
    'scope',pg_catalog.jsonb_build_object(
      'app_id','00000000-0000-4000-8000-00000000da01',
      'tenant_id','00000000-0000-4000-8000-000000006601','environment','local',
      'workspace_id','00000000-0000-4000-8000-000000006601'
    ),'policy_id','00000000-0000-4000-8000-00000000f601','revision',1,'parent_ref',null,
    'quarantine_ttl_seconds',86400,'deleted_reference_ttl_seconds',0,
    'orphan_blob_ttl_seconds',86400,'backup_expiry_seconds',1,'legal_hold_enabled',true,
    'created_by_principal_id','00000000-0000-4000-8000-000000006602',
    'created_at',app_data_agent.workspace_file_utc_millis(created)
  );
  document:=document||pg_catalog.jsonb_build_object(
    'policy_hash',app_data_agent.u2_canonical_sha256(document)
  );
  insert into app_data_agent.storage_retention_policy_revisions(
    app_id,tenant_id,environment,policy_id,revision,policy_hash,policy_json,created_at
  ) values (
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000006601',
    'local','00000000-0000-4000-8000-00000000f601',1,document->>'policy_hash',document,created
  );
end
$policy$;
create role data_agent_u6_behavior_session login inherit;
grant data_agent_backend to data_agent_u6_behavior_session with inherit true;
grant execute on function app_data_agent.u2_canonical_sha256(jsonb),app_data_agent.job_utc_millis(timestamptz)
to data_agent_u6_behavior_session;
grant execute on function app_data_agent.workspace_file_default_retention_policy(uuid,uuid,text,uuid,timestamptz)
to data_agent_u6_behavior_session;
grant execute on function app_data_agent.build_requested_optional_resource_bindings(jsonb)
to data_agent_u6_behavior_session;
set session authorization data_agent_u6_behavior_session;
select pg_catalog.set_config('data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
select pg_catalog.set_config('data_agent.tenant_id','00000000-0000-4000-8000-000000006601',true);
select pg_catalog.set_config('data_agent.environment','local',true);
select pg_catalog.set_config('data_agent.deployment_id','00000000-0000-4000-8000-000000000001',true);
select pg_catalog.set_config('data_agent.principal_id','00000000-0000-4000-8000-000000006602',true);
select pg_catalog.set_config('data_agent.role','owner',true);

do $behavior$
declare
  scope jsonb:=pg_catalog.jsonb_build_object(
    'app_id','00000000-0000-4000-8000-00000000da01',
    'tenant_id','00000000-0000-4000-8000-000000006601','environment','local'
  );
  workspace_scope jsonb:=scope||pg_catalog.jsonb_build_object(
    'workspace_id','00000000-0000-4000-8000-000000006601'
  );
  upload jsonb; quarantined jsonb; submit jsonb; job_receipt jsonb; heartbeat jsonb;
  full_handlers jsonb; full_heartbeat jsonb;
  lease jsonb; target jsonb; scan jsonb; scanned jsonb; terminal jsonb;
  promote jsonb; promoted jsonb; download jsonb; deletion jsonb; deleted jsonb;
  hold_command jsonb; hold_receipt jsonb; release_command jsonb; release_receipt jsonb;
  gc_command jsonb; gc_result jsonb; gc_commit jsonb; gc_deleted jsonb;
  retention_command jsonb; retention_policy jsonb; orphan_check jsonb;
  config_request jsonb; file_bindings jsonb;
  download_rejected boolean:=false; hold_after_gc_rejected boolean:=false;
begin
  full_handlers:=pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('kind','ARTIFACT_EXPORT','handler_revision','artifact-export-handler@1.0.0'),
    pg_catalog.jsonb_build_object('kind','DATALINK_REBUILD','handler_revision','datalink-rebuild-handler@1.0.0'),
    pg_catalog.jsonb_build_object('kind','FILE_SCAN','handler_revision','file-scan-handler@1.0.0'),
    pg_catalog.jsonb_build_object('kind','METRIC_IMPORT','handler_revision','metric-import-handler@1.0.0'),
    pg_catalog.jsonb_build_object('kind','RELATIONSHIP_INDEX','handler_revision','relationship-index-handler@1.0.0'),
    pg_catalog.jsonb_build_object('kind','SCHEMA_SCAN','handler_revision','schema-scan-handler@1.0.0'),
    pg_catalog.jsonb_build_object('kind','SEMANTIC_INDUCTION','handler_revision','semantic-induction-handler@1.0.0')
  );
  full_heartbeat:=pg_catalog.jsonb_build_object(
    'schema_version','job-worker-heartbeat@1.0.0',
    'heartbeat_id','00000000-0000-4000-8000-000000006619','scope',scope,
    'worker_id','u6-full-manifest-worker','handlers',full_handlers,'capacity',7,
    'observed_at',app_data_agent.job_utc_millis(pg_catalog.clock_timestamp()),
    'expires_at',app_data_agent.job_utc_millis(pg_catalog.clock_timestamp()+interval '2 minutes')
  );
  full_heartbeat:=full_heartbeat||pg_catalog.jsonb_build_object(
    'heartbeat_hash',app_data_agent.u2_canonical_sha256(full_heartbeat)
  );
  perform app_data_agent.publish_job_worker_heartbeat(full_heartbeat);
  if app_data_agent.claim_job_work('u6-full-manifest-worker',full_handlers,30000) is not null
  then raise exception 'WORKSPACE_FILES_FULL_JOB_MANIFEST_CLAIM_INVALID'; end if;

  select policy_json into strict retention_policy
  from app_data_agent.workspace_file_default_retention_policy(
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000006601',
    'local','00000000-0000-4000-8000-000000006602',pg_catalog.clock_timestamp()
  );
  retention_command:=pg_catalog.jsonb_build_object(
    'schema_version','storage-retention-policy-update@1.0.0',
    'operation_id','00000000-0000-4000-8000-000000006620',
    'workspace_id','00000000-0000-4000-8000-000000006601',
    'expected_policy_ref',pg_catalog.jsonb_build_object(
      'policy_id',retention_policy->>'policy_id',
      'policy_revision',(retention_policy->>'revision')::bigint,
      'policy_hash',retention_policy->>'policy_hash'
    ),'quarantine_ttl_seconds',3600,'deleted_reference_ttl_seconds',0,
    'orphan_blob_ttl_seconds',3600,'backup_expiry_seconds',1,
    'legal_hold_enabled',true,'idempotency_key','u6-retention-0001'
  );
  retention_command:=retention_command||pg_catalog.jsonb_build_object(
    'request_hash',app_data_agent.u2_canonical_sha256(retention_command)
  );
  retention_policy:=app_data_agent.update_storage_retention_policy(retention_command);
  if retention_policy->>'revision'<>'2'
    or retention_policy#>>'{parent_ref,policy_hash}'<>
      retention_command#>>'{expected_policy_ref,policy_hash}'
    or app_data_agent.update_storage_retention_policy(retention_command)<>retention_policy
  then raise exception 'STORAGE_RETENTION_POLICY_UPDATE_INVALID'; end if;

  orphan_check:=app_data_agent.classify_workspace_content_orphan(
    pg_catalog.jsonb_build_object(
      'schema_version','workspace-content-orphan-check@1.0.0',
      'workspace_id','00000000-0000-4000-8000-000000006601',
      'storage_key','workspace-content/v1/00000000-0000-4000-8000-00000000da01/00000000-0000-4000-8000-000000006601/local/bb/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'blob_hash','sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'observed_at',app_data_agent.workspace_file_utc_millis(pg_catalog.clock_timestamp()-interval '2 hours')
    )
  );
  if orphan_check->>'authorized'<>'false' or orphan_check->>'orphan_ttl_seconds'<>'3600'
  then raise exception 'WORKSPACE_CONTENT_ORPHAN_CLASSIFICATION_INVALID'; end if;

  upload:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-file-upload-commit@1.0.0',
    'operation_id','00000000-0000-4000-8000-000000006603',
    'workspace_id','00000000-0000-4000-8000-000000006601',
    'intent',pg_catalog.jsonb_build_object(
      'schema_version','workspace-file-upload-intent@1.0.0','original_filename','fixture.txt',
      'visibility','SESSION','session_id','00000000-0000-4000-8000-000000006604',
      'idempotency_key','u6-upload-0001'
    ),
    'observed_content',pg_catalog.jsonb_build_object(
      'blob_hash','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'byte_size',5,'detected_mime','text/plain',
      'storage_key','workspace-content/v1/00000000-0000-4000-8000-00000000da01/00000000-0000-4000-8000-000000006601/local/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )
  );
  upload:=upload||pg_catalog.jsonb_build_object('request_hash',app_data_agent.u2_canonical_sha256(upload));
  quarantined:=app_data_agent.commit_workspace_file_upload(upload);
  if quarantined->>'status'<>'QUARANTINED'
    or quarantined->>'revision_hash'<>app_data_agent.u2_canonical_sha256(quarantined-'revision_hash')
    or app_data_agent.commit_workspace_file_upload(upload)<>quarantined
  then raise exception 'WORKSPACE_FILE_UPLOAD_OR_REPLAY_INVALID'; end if;

  submit:=pg_catalog.jsonb_build_object(
    'schema_version','job-submit@1.0.0','scope',scope,'kind','FILE_SCAN',
    'idempotency_key','u6-file-scan-0001',
    'input',pg_catalog.jsonb_build_object(
      'schema_version','job-input@1.0.0','kind','FILE_SCAN','resource_refs','[]'::jsonb,
      'parameters',pg_catalog.jsonb_build_object(
        'file_id',quarantined->>'file_id','revision',(quarantined->>'revision')::bigint,
        'revision_hash',quarantined->>'revision_hash'
      )
    ),'priority',50,'max_attempts',3,'cancel_policy','COOPERATIVE'
  );
  submit:=submit||pg_catalog.jsonb_build_object('request_hash',app_data_agent.u2_canonical_sha256(submit));
  job_receipt:=app_data_agent.enqueue_job(submit);
  heartbeat:=pg_catalog.jsonb_build_object(
    'schema_version','job-worker-heartbeat@1.0.0',
    'heartbeat_id','00000000-0000-4000-8000-000000006605','scope',scope,
    'worker_id','u6-file-worker','handlers',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'kind','FILE_SCAN','handler_revision','file-scan-handler@1.0.0'
    )),'capacity',1,'observed_at',app_data_agent.job_utc_millis(pg_catalog.clock_timestamp()),
    'expires_at',app_data_agent.job_utc_millis(pg_catalog.clock_timestamp()+interval '2 minutes')
  );
  heartbeat:=heartbeat||pg_catalog.jsonb_build_object(
    'heartbeat_hash',app_data_agent.u2_canonical_sha256(heartbeat)
  );
  perform app_data_agent.publish_job_worker_heartbeat(heartbeat);
  lease:=app_data_agent.claim_job_work('u6-file-worker',heartbeat->'handlers',30000);
  perform app_data_agent.start_job_work(lease);
  target:=app_data_agent.load_workspace_file_for_scan(lease);
  if target->'file'<>quarantined or target->>'blob_hash'<>quarantined->>'blob_hash'
  then raise exception 'WORKSPACE_FILE_SCAN_TARGET_INVALID'; end if;
  scan:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-file-scan-commit@1.0.0',
    'file_ref',pg_catalog.jsonb_build_object(
      'file_id',quarantined->>'file_id','revision',(quarantined->>'revision')::bigint,
      'revision_hash',quarantined->>'revision_hash'
    ),'blob_hash',quarantined->>'blob_hash','byte_size',5,
    'scanner',pg_catalog.jsonb_build_object(
      'engine','CLAMAV','engine_version','1.4.5','signature_version','fixture-1',
      'signature_observed_at',app_data_agent.job_utc_millis(pg_catalog.clock_timestamp()),
      'policy_version','workspace-file-policy@1.0.0'
    ),'verdict','CLEAN','malware_name',null,'credential_match_count',0,
    'content_policy_findings','[]'::jsonb
  );
  scanned:=app_data_agent.commit_workspace_file_scan(lease,scan);
  if scanned#>>'{revision,status}'<>'READY'
    or scanned#>>'{scan_receipt,receipt_hash}'<>
      app_data_agent.u2_canonical_sha256((scanned->'scan_receipt')-'receipt_hash')
  then raise exception 'WORKSPACE_FILE_SCAN_RESULT_INVALID'; end if;
  terminal:=app_data_agent.succeed_job_work(lease,pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'schema_version','job-domain-output-reference@1.0.0',
      'resource_kind','WORKSPACE_FILE_SCAN_RECEIPT',
      'app_id',scanned#>>'{scan_receipt,scope,app_id}',
      'tenant_id',scanned#>>'{scan_receipt,scope,tenant_id}',
      'environment',scanned#>>'{scan_receipt,scope,environment}',
      'resource_id',scanned#>>'{scan_receipt,receipt_id}',
      'resource_revision',1,
      'resource_hash',scanned#>>'{scan_receipt,receipt_hash}'
    )
  ));
  if terminal->>'terminal'<>'SUCCEEDED' then raise exception 'WORKSPACE_FILE_JOB_TERMINAL_INVALID'; end if;

  promote:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-file-promote@1.0.0',
    'operation_id','00000000-0000-4000-8000-000000006606',
    'workspace_id','00000000-0000-4000-8000-000000006601',
    'file_ref',pg_catalog.jsonb_build_object(
      'file_id',scanned#>>'{revision,file_id}','revision',(scanned#>>'{revision,revision}')::bigint,
      'revision_hash',scanned#>>'{revision,revision_hash}'
    ),'idempotency_key','u6-promote-0001'
  );
  promote:=promote||pg_catalog.jsonb_build_object('request_hash',app_data_agent.u2_canonical_sha256(promote));
  promoted:=app_data_agent.promote_workspace_file(promote);
  if promoted->>'visibility'<>'WORKSPACE' or promoted->>'status'<>'READY'
  then raise exception 'WORKSPACE_FILE_PROMOTION_INVALID'; end if;
  download:=app_data_agent.resolve_workspace_file_download(
    (promoted->>'file_id')::uuid,(promoted->>'revision')::bigint,promoted->>'revision_hash'
  );
  if download->>'storage_key'<>upload#>>'{observed_content,storage_key}'
  then raise exception 'WORKSPACE_FILE_DOWNLOAD_AUTHORITY_INVALID'; end if;
  config_request:=pg_catalog.jsonb_build_object(
    'overrides',pg_catalog.jsonb_build_object(
      'files',pg_catalog.jsonb_build_object(
        'mode','RESOURCE_IDS','resources',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'resource_id',promoted->>'file_id','expected_revision',(promoted->>'revision')::bigint
        ))
      ),
      'knowledge',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE'),
      'mcp_servers',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE'),
      'skills',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE')
    ),'mentions','[]'::jsonb
  );
  file_bindings:=app_data_agent.build_requested_optional_resource_bindings(config_request);
  if pg_catalog.jsonb_array_length(file_bindings)<>1
    or file_bindings#>>'{0,availability}'<>'AVAILABLE'
    or file_bindings#>>'{0,effective_resource,resource_hash}'<>promoted->>'revision_hash'
  then raise exception 'WORKSPACE_FILES_EFFECTIVE_CONFIG_AVAILABLE_INVALID'; end if;

  hold_command:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-file-legal-hold@1.0.0',
    'operation_id','00000000-0000-4000-8000-000000006608',
    'workspace_id','00000000-0000-4000-8000-000000006601',
    'file_id',promoted->>'file_id','active',true,'reason_code','LEGAL_REQUEST',
    'idempotency_key','u6-hold-0001'
  );
  hold_command:=hold_command||pg_catalog.jsonb_build_object(
    'request_hash',app_data_agent.u2_canonical_sha256(hold_command)
  );
  hold_receipt:=app_data_agent.set_workspace_file_legal_hold(hold_command);
  if hold_receipt->>'active'<>'true'
    or hold_receipt->>'hold_hash'<>app_data_agent.u2_canonical_sha256(hold_receipt-'hold_hash')
  then raise exception 'WORKSPACE_FILE_LEGAL_HOLD_INVALID'; end if;

  deletion:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-file-delete@1.0.0',
    'operation_id','00000000-0000-4000-8000-000000006607',
    'workspace_id','00000000-0000-4000-8000-000000006601',
    'file_ref',pg_catalog.jsonb_build_object(
      'file_id',promoted->>'file_id','revision',(promoted->>'revision')::bigint,
      'revision_hash',promoted->>'revision_hash'
    ),'idempotency_key','u6-delete-0001'
  );
  deletion:=deletion||pg_catalog.jsonb_build_object('request_hash',app_data_agent.u2_canonical_sha256(deletion));
  deleted:=app_data_agent.delete_workspace_file(deletion);
  if deleted#>>'{revision,status}'<>'DELETED'
    or deleted#>>'{deletion_receipt,receipt_hash}'<>
      app_data_agent.u2_canonical_sha256((deleted->'deletion_receipt')-'receipt_hash')
  then raise exception 'WORKSPACE_FILE_DELETE_RESULT_INVALID'; end if;
  if deleted#>>'{deletion_receipt,legal_hold_active}'<>'true'
    or deleted#>>'{deletion_receipt,blob_deletion_status}'<>'RETAINED_BY_LEGAL_HOLD'
  then raise exception 'WORKSPACE_FILE_DELETE_HOLD_CLOSURE_INVALID'; end if;
  begin
    perform app_data_agent.resolve_workspace_file_download(
      (promoted->>'file_id')::uuid,(promoted->>'revision')::bigint,promoted->>'revision_hash'
    );
  exception when insufficient_privilege or no_data_found then download_rejected:=true;
  end;
  if not download_rejected then raise exception 'WORKSPACE_FILE_DELETED_BYTES_STILL_AUTHORIZED'; end if;
  file_bindings:=app_data_agent.build_requested_optional_resource_bindings(config_request);
  if pg_catalog.jsonb_array_length(file_bindings)<>1
    or file_bindings#>>'{0,availability}'<>'UNAVAILABLE'
    or file_bindings#>>'{0,unavailable_reason}'<>'RESOURCE_NOT_FOUND_OR_FORBIDDEN'
  then raise exception 'WORKSPACE_FILES_EFFECTIVE_CONFIG_DELETE_INVALID'; end if;

  gc_command:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-content-gc-evaluate@1.0.0',
    'operation_id','00000000-0000-4000-8000-000000006609',
    'workspace_id','00000000-0000-4000-8000-000000006601',
    'blob_hash',promoted->>'blob_hash','idempotency_key','u6-gc-held-0001'
  );
  gc_command:=gc_command||pg_catalog.jsonb_build_object(
    'request_hash',app_data_agent.u2_canonical_sha256(gc_command)
  );
  gc_result:=app_data_agent.evaluate_workspace_content_gc(gc_command);
  if gc_result#>>'{receipt,status}'<>'HELD' or gc_result->'deletion_authority'<>'null'::jsonb
  then raise exception 'WORKSPACE_CONTENT_GC_IGNORED_LEGAL_HOLD'; end if;

  release_command:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-file-legal-hold@1.0.0',
    'operation_id','00000000-0000-4000-8000-000000006610',
    'workspace_id','00000000-0000-4000-8000-000000006601',
    'file_id',promoted->>'file_id','active',false,'reason_code','RELEASED',
    'idempotency_key','u6-hold-release-0001'
  );
  release_command:=release_command||pg_catalog.jsonb_build_object(
    'request_hash',app_data_agent.u2_canonical_sha256(release_command)
  );
  release_receipt:=app_data_agent.set_workspace_file_legal_hold(release_command);
  if release_receipt->>'active'<>'false' or release_receipt->>'reason_code'<>'RELEASED'
  then raise exception 'WORKSPACE_FILE_LEGAL_HOLD_RELEASE_INVALID'; end if;
  perform pg_catalog.pg_sleep(1.1);
  gc_command:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-content-gc-evaluate@1.0.0',
    'operation_id','00000000-0000-4000-8000-000000006611',
    'workspace_id','00000000-0000-4000-8000-000000006601',
    'blob_hash',promoted->>'blob_hash','idempotency_key','u6-gc-delete-0001'
  );
  gc_command:=gc_command||pg_catalog.jsonb_build_object(
    'request_hash',app_data_agent.u2_canonical_sha256(gc_command)
  );
  gc_result:=app_data_agent.evaluate_workspace_content_gc(gc_command);
  if gc_result#>>'{receipt,status}'<>'ELIGIBLE'
    or gc_result#>>'{deletion_authority,blob_hash}'<>promoted->>'blob_hash'
    or app_data_agent.evaluate_workspace_content_gc(gc_command)<>gc_result
  then raise exception 'WORKSPACE_CONTENT_GC_ELIGIBILITY_INVALID'; end if;
  begin
    hold_command:=pg_catalog.jsonb_build_object(
      'schema_version','workspace-file-legal-hold@1.0.0',
      'operation_id','00000000-0000-4000-8000-000000006612',
      'workspace_id','00000000-0000-4000-8000-000000006601',
      'file_id',promoted->>'file_id','active',true,'reason_code','AUDIT_PRESERVATION',
      'idempotency_key','u6-hold-too-late-0001'
    );
    hold_command:=hold_command||pg_catalog.jsonb_build_object(
      'request_hash',app_data_agent.u2_canonical_sha256(hold_command)
    );
    perform app_data_agent.set_workspace_file_legal_hold(hold_command);
  exception when serialization_failure then hold_after_gc_rejected:=true;
  end;
  if not hold_after_gc_rejected then raise exception 'WORKSPACE_CONTENT_GC_HOLD_RACE_UNSAFE'; end if;
  gc_commit:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-content-gc-commit@1.0.0',
    'workspace_id','00000000-0000-4000-8000-000000006601',
    'receipt_id',gc_result#>>'{receipt,receipt_id}',
    'receipt_hash',gc_result#>>'{receipt,receipt_hash}','blob_hash',promoted->>'blob_hash'
  );
  gc_deleted:=app_data_agent.commit_workspace_content_gc(gc_commit);
  if gc_deleted->>'status'<>'DELETED'
    or gc_deleted#>>'{parent_receipt_ref,receipt_hash}'<>gc_result#>>'{receipt,receipt_hash}'
    or app_data_agent.commit_workspace_content_gc(gc_commit)<>gc_deleted
  then raise exception 'WORKSPACE_CONTENT_GC_COMMIT_INVALID'; end if;
end
$behavior$;

reset session authorization;
rollback;

select 'U6_WORKSPACE_FILES_AUTHORITY_ASSERTIONS_PASSED' as result;
