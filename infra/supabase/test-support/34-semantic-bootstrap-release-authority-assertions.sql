\set ON_ERROR_STOP on

begin isolation level repeatable read read only;
do $semantic_bootstrap_surface$
declare
  relation_name text;
  function_name text;
  definition text;
begin
  if not exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010656_app_data_agent_semantic_bootstrap_release'
  ) then
    raise exception 'SEMANTIC_BOOTSTRAP_LEDGER_ASSERTION_FAILED';
  end if;
  foreach relation_name in array array[
    'semantic_bootstrap_signer_key_revisions','semantic_bootstrap_signer_activations',
    'verified_semantic_domain_bootstrap_receipts','semantic_bootstrap_policy_revisions',
    'semantic_bootstrap_policy_pointer','semantic_bootstrap_publisher_grants',
    'semantic_bootstrap_validation_receipts','initial_semantic_release_sets',
    'initial_semantic_release_package_bindings','semantic_package_admission_receipts',
    'first_release_admission_receipts','semantic_bootstrap_capability_tombstones',
    'semantic_bootstrap_publish_idempotency','semantic_bootstrap_outbox'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'semantic' and relation.relname = relation_name
        and relation.relrowsecurity and relation.relforcerowsecurity
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend',pg_catalog.format('semantic.%I',relation_name),'INSERT,UPDATE,DELETE'
    ) then
      raise exception 'SEMANTIC_BOOTSTRAP_RELATION_SURFACE_ASSERTION_FAILED:%',relation_name;
    end if;
  end loop;
  if exists (
    select 1 from pg_catalog.pg_roles
    where rolname in (
      'data_agent_u5_data_owner','data_agent_u5_verifier_owner',
      'data_agent_u5_publisher_owner','data_agent_u5_human_governance_owner'
    ) and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolinherit or rolbypassrls)
  ) then
    raise exception 'SEMANTIC_BOOTSTRAP_ROLE_ASSERTION_FAILED';
  end if;
  foreach function_name in array array[
    'load_semantic_bootstrap_signer_context','commit_verified_semantic_domain_bootstrap',
    'create_semantic_bootstrap_publisher_grant','commit_semantic_bootstrap_validation',
    'publish_initial_semantic_release_set','load_initial_semantic_release_set',
    'human_prepare_publish_attempt','human_commit_publish_attempt','human_execute_rollback'
  ] loop
    select pg_catalog.pg_get_functiondef(procedure.oid) into strict definition
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'semantic' and procedure.proname = function_name;
    if definition not like '%SECURITY DEFINER%' or definition not like '%SET search_path TO ''''%'
    then
      raise exception 'SEMANTIC_BOOTSTRAP_RPC_HARDENING_ASSERTION_FAILED:%',function_name;
    end if;
  end loop;
  if pg_catalog.has_function_privilege(
    'data_agent_backend',
    'semantic.bootstrap_domain(uuid,uuid,text,text,uuid,text,text,text,text,text,text,jsonb,text,jsonb,text,text,text,uuid,timestamptz)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'anon',
    'semantic.publish_initial_semantic_release_set(jsonb)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'data_agent_backend','semantic.commit_verified_semantic_domain_bootstrap(jsonb)','EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'data_agent_backend','semantic.create_semantic_bootstrap_publisher_grant(jsonb)','EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'data_agent_u5_verifier_owner','semantic.publish_initial_semantic_release_set(jsonb)','EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'data_agent_u5_publisher_owner','semantic.commit_verified_semantic_domain_bootstrap(jsonb)','EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'data_agent_backend','semantic.human_prepare_publish_attempt(jsonb)','EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'data_agent_backend','semantic.human_commit_publish_attempt(jsonb)','EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'data_agent_backend','semantic.human_execute_rollback(jsonb)','EXECUTE'
  ) then
    raise exception 'SEMANTIC_BOOTSTRAP_LEGACY_OR_PUBLIC_EXECUTE_ASSERTION_FAILED';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid='semantic.initial_semantic_release_package_bindings'::regclass
      and constraint_row.contype='f'
      and constraint_row.confrelid='semantic.semantic_graph_projection'::regclass
  ) then
    raise exception 'SEMANTIC_BOOTSTRAP_GRAPH_BINDING_FK_ASSERTION_FAILED';
  end if;
end
$semantic_bootstrap_surface$;
rollback;

do $semantic_bootstrap_greenfield_empty$
begin
  if (select pg_catalog.count(*) from semantic.initial_semantic_release_sets) <> 0
    or (select pg_catalog.count(*) from semantic.first_release_admission_receipts) <> 0
    or (select pg_catalog.count(*) from semantic.semantic_bootstrap_capability_tombstones) <> 0
  then
    raise exception 'SEMANTIC_BOOTSTRAP_GREENFIELD_TABLES_NOT_EMPTY';
  end if;
end
$semantic_bootstrap_greenfield_empty$;

-- Exercise one generation-zero to generation-one publish using two immutable U4
-- packages from one real Candidate Set Root. The entire fixture rolls back and
-- imports no benchmark or application data.
begin;

insert into app_data_agent.workspaces (
  app_id,environment,workspace_id,slug,display_name
) values (
  '00000000-0000-4000-8000-00000000da01'::uuid,'local',
  '00000000-0000-4000-8000-00000000a501'::uuid,
  'u5-bootstrap-release-fixture','U5 bootstrap release fixture'
);

insert into app_data_agent.memberships (
  app_id,tenant_id,environment,principal_id,membership_role,
  workspace_role,membership_source,system_override
) values (
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000a501'::uuid,'local',
  '00000000-0000-4000-8000-00000000a502'::uuid,
  'owner','WORKSPACE_ADMIN','EXPLICIT',false
);

insert into app_data_agent.datasource_connections (
  app_id,tenant_id,environment,datasource_id,name,datasource_type,file_path,
  status,created_by_principal_id
) values (
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000a501'::uuid,'local',
  '00000000-0000-4000-8000-00000000a519'::uuid,
  'U5 fixture datasource','sqlite','/tmp/u5-bootstrap-release-fixture.db',
  'ACTIVE','00000000-0000-4000-8000-00000000a502'::uuid
);

insert into semantic.semantic_source_revision (
  app_id,tenant_id,environment,semantic_domain,revision_id,revision_number,
  source_payload,source_digest,author_principal,change_class
) values (
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000a501'::uuid,'local','commerce',
  '00000000-0000-4000-8000-00000000a505'::uuid,1,
  '{"fixture":"u5-bootstrap-release"}'::jsonb,
  'sha256:' || pg_catalog.repeat('5',64),
  '00000000-0000-4000-8000-00000000a502','MAJOR'
);

create temporary table u5_bootstrap_release_documents (
  scope jsonb not null,
  packages jsonb not null,
  policy jsonb,
  packet jsonb,
  verified_receipt jsonb,
  grant_result jsonb,
  validation_receipt jsonb,
  release_set jsonb,
  publish_command jsonb,
  publish_result jsonb
) on commit drop;

do $semantic_bootstrap_documents$
declare
  v_scope jsonb;
  v_root jsonb;
  v_gates jsonb;
  v_package_a jsonb;
  v_package_b jsonb;
  v_packages jsonb;
  v_policy jsonb;
begin
  v_scope:=pg_catalog.jsonb_build_object(
    'app_id','00000000-0000-4000-8000-00000000da01',
    'tenant_id','00000000-0000-4000-8000-00000000a501',
    'workspace_id','00000000-0000-4000-8000-00000000a501',
    'environment','local'
  );
  v_root:=pg_catalog.jsonb_build_object(
    'candidate_id','00000000-0000-4000-8000-00000000a506',
    'revision_id','00000000-0000-4000-8000-00000000a507',
    'revision',1,'revision_digest','sha256:' || pg_catalog.repeat('8',64),
    'candidate_set_hash','sha256:' || pg_catalog.repeat('9',64)
  );
  v_gates:='{"coverage":"PASS","lowerability":"PASS","source_boundary":"PASS","mapping_evidence":"PASS","join_evidence":"PASS","formula_compiler":"PASS","query_dry_run":"PASS"}'::jsonb;
  v_package_a:=pg_catalog.jsonb_build_object(
    'namespace_id','00000000-0000-4000-8000-00000000a50a',
    'package_id','00000000-0000-4000-8000-00000000a51a','package_version',1,
    'package_hash','sha256:' || pg_catalog.repeat('a',64),
    'candidate_revision',v_root,
    'validation_receipt',pg_catalog.jsonb_build_object(
      'receipt_id','00000000-0000-4000-8000-00000000a52a',
      'receipt_hash','sha256:' || pg_catalog.repeat('c',64)
    ),
    'preview_binding',pg_catalog.jsonb_build_object(
      'preview_id','00000000-0000-4000-8000-00000000a53a',
      'preview_hash','sha256:' || pg_catalog.repeat('e',64),
      'projection_id','00000000-0000-4000-8000-00000000a54a',
      'projection_hash','sha256:' || pg_catalog.repeat('1',64)
    ),
    'mandatory',true,'gates',v_gates
  );
  v_package_b:=pg_catalog.jsonb_build_object(
    'namespace_id','00000000-0000-4000-8000-00000000a50b',
    'package_id','00000000-0000-4000-8000-00000000a51b','package_version',1,
    'package_hash','sha256:' || pg_catalog.repeat('b',64),
    'candidate_revision',v_root,
    'validation_receipt',pg_catalog.jsonb_build_object(
      'receipt_id','00000000-0000-4000-8000-00000000a52b',
      'receipt_hash','sha256:' || pg_catalog.repeat('d',64)
    ),
    'preview_binding',pg_catalog.jsonb_build_object(
      'preview_id','00000000-0000-4000-8000-00000000a53b',
      'preview_hash','sha256:' || pg_catalog.repeat('f',64),
      'projection_id','00000000-0000-4000-8000-00000000a54b',
      'projection_hash','sha256:' || pg_catalog.repeat('2',64)
    ),
    'mandatory',true,'gates',v_gates
  );
  v_packages:=pg_catalog.jsonb_build_array(v_package_a,v_package_b);
  v_policy:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-bootstrap-policy-view@1.0.0',
    'policy_id','00000000-0000-4000-8000-00000000a520',
    'policy_revision',1,'scope',v_scope,'semantic_domain','commerce',
    'mandatory_manifest',pg_catalog.jsonb_build_object(
      'manifest_id','00000000-0000-4000-8000-00000000a521',
      'manifest_version','mandatory-release-manifest@1.0.0',
      'manifest_hash','sha256:' || pg_catalog.repeat('4',64)
    ),
    'coverage_policy',pg_catalog.jsonb_build_object(
      'policy_id','semantic-coverage-floor','policy_version','semantic-coverage-floor@1.0.0',
      'policy_hash','sha256:' || pg_catalog.repeat('5',64)
    ),
    'lowerability_policy',pg_catalog.jsonb_build_object(
      'policy_id','semantic-lowerability','policy_version','semantic-lowerability@1.0.0',
      'policy_hash','sha256:' || pg_catalog.repeat('6',64)
    ),
    'source_boundary',pg_catalog.jsonb_build_object(
      'boundary_id','semantic-bootstrap-source-boundary',
      'boundary_version','semantic-bootstrap-source-boundary@1.0.0',
      'boundary_hash','sha256:' || pg_catalog.repeat('7',64)
    ),
    'valid_from',pg_catalog.clock_timestamp()-interval '1 minute',
    'valid_until',pg_catalog.clock_timestamp()+interval '1 hour'
  );
  v_policy:=v_policy||pg_catalog.jsonb_build_object(
    'policy_hash',app_data_agent.u2_canonical_sha256(v_policy)
  );
  insert into u5_bootstrap_release_documents(scope,packages,policy)
  values (v_scope,v_packages,v_policy);
end
$semantic_bootstrap_documents$;

insert into semantic.semantic_candidate (
  app_id,tenant_id,environment,semantic_domain,candidate_id,proposer_principal,
  current_revision_id,candidate_status
) values (
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000a501'::uuid,'local','commerce',
  '00000000-0000-4000-8000-00000000a506'::uuid,
  '00000000-0000-4000-8000-00000000a502',
  '00000000-0000-4000-8000-00000000a507'::uuid,'PUBLISHING'
);

insert into semantic.semantic_candidate_revision (
  app_id,tenant_id,environment,semantic_domain,candidate_id,revision_id,
  revision_number,source_revision_id,revision_payload,revision_digest,
  author_principal,change_class
) select
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000a501'::uuid,'local','commerce',
  '00000000-0000-4000-8000-00000000a506'::uuid,
  '00000000-0000-4000-8000-00000000a507'::uuid,1,
  '00000000-0000-4000-8000-00000000a505'::uuid,
  pg_catalog.jsonb_build_object(
    'candidate_set_hash','sha256:' || pg_catalog.repeat('9',64),
    'packages',documents.packages
  ),
  'sha256:' || pg_catalog.repeat('8',64),
  '00000000-0000-4000-8000-00000000a502','MAJOR'
from u5_bootstrap_release_documents as documents;

insert into semantic.semantic_graph_projection (
  app_id,tenant_id,environment,semantic_domain,projection_id,graph_id,
  source_revision_id,source_revision_digest,source_digest,registry_digest,
  compiler_version,projection_payload,projection_storage_digest,node_count,
  edge_count,created_by
) values
  ('00000000-0000-4000-8000-00000000da01'::uuid,
   '00000000-0000-4000-8000-00000000a501'::uuid,'local','commerce',
   '00000000-0000-4000-8000-00000000a54a'::uuid,
   '00000000-0000-4000-8000-00000000a55a'::uuid,
   '00000000-0000-4000-8000-00000000a505'::uuid,
   'sha256:' || pg_catalog.repeat('5',64),'sha256:' || pg_catalog.repeat('3',64),
   'sha256:' || pg_catalog.repeat('4',64),'u5-bootstrap-fixture-a@1.0.0',
   '{"fixture":"package-a"}'::jsonb,'sha256:' || pg_catalog.repeat('1',64),0,0,
   '00000000-0000-4000-8000-00000000a502'::uuid),
  ('00000000-0000-4000-8000-00000000da01'::uuid,
   '00000000-0000-4000-8000-00000000a501'::uuid,'local','commerce',
   '00000000-0000-4000-8000-00000000a54b'::uuid,
   '00000000-0000-4000-8000-00000000a55b'::uuid,
   '00000000-0000-4000-8000-00000000a505'::uuid,
   'sha256:' || pg_catalog.repeat('5',64),'sha256:' || pg_catalog.repeat('3',64),
   'sha256:' || pg_catalog.repeat('4',64),'u5-bootstrap-fixture-b@1.0.0',
   '{"fixture":"package-b"}'::jsonb,'sha256:' || pg_catalog.repeat('2',64),0,0,
   '00000000-0000-4000-8000-00000000a502'::uuid);

insert into semantic.ontology_package_candidates (
  app_id,tenant_id,environment,semantic_domain,namespace_id,package_id,
  package_version,package_hash,candidate_id,revision_id,revision_digest,
  package_json,committed_by
) values
  ('00000000-0000-4000-8000-00000000da01'::uuid,
   '00000000-0000-4000-8000-00000000a501'::uuid,'local','commerce',
   '00000000-0000-4000-8000-00000000a50a'::uuid,
   '00000000-0000-4000-8000-00000000a51a'::uuid,1,
   'sha256:' || pg_catalog.repeat('a',64),
   '00000000-0000-4000-8000-00000000a506'::uuid,
   '00000000-0000-4000-8000-00000000a507'::uuid,
   'sha256:' || pg_catalog.repeat('8',64),'{"fixture":"package-a"}'::jsonb,
   '00000000-0000-4000-8000-00000000a502'::uuid),
  ('00000000-0000-4000-8000-00000000da01'::uuid,
   '00000000-0000-4000-8000-00000000a501'::uuid,'local','commerce',
   '00000000-0000-4000-8000-00000000a50b'::uuid,
   '00000000-0000-4000-8000-00000000a51b'::uuid,1,
   'sha256:' || pg_catalog.repeat('b',64),
   '00000000-0000-4000-8000-00000000a506'::uuid,
   '00000000-0000-4000-8000-00000000a507'::uuid,
   'sha256:' || pg_catalog.repeat('8',64),'{"fixture":"package-b"}'::jsonb,
   '00000000-0000-4000-8000-00000000a502'::uuid);

insert into semantic.ontology_package_validation_receipts (
  app_id,tenant_id,environment,semantic_domain,receipt_id,namespace_id,
  package_id,package_version,package_hash,source_binding_hash,compiler_digest,
  validator_version,valid,receipt_json,receipt_hash,committed_by
) values
  ('00000000-0000-4000-8000-00000000da01'::uuid,
   '00000000-0000-4000-8000-00000000a501'::uuid,'local','commerce',
   '00000000-0000-4000-8000-00000000a52a'::uuid,
   '00000000-0000-4000-8000-00000000a50a'::uuid,
   '00000000-0000-4000-8000-00000000a51a'::uuid,1,
   'sha256:' || pg_catalog.repeat('a',64),'sha256:' || pg_catalog.repeat('3',64),
   'sha256:' || pg_catalog.repeat('4',64),'u5-bootstrap-validator@1.0.0',true,
   '{"outcome":"PASS"}'::jsonb,'sha256:' || pg_catalog.repeat('c',64),
   '00000000-0000-4000-8000-00000000a502'::uuid),
  ('00000000-0000-4000-8000-00000000da01'::uuid,
   '00000000-0000-4000-8000-00000000a501'::uuid,'local','commerce',
   '00000000-0000-4000-8000-00000000a52b'::uuid,
   '00000000-0000-4000-8000-00000000a50b'::uuid,
   '00000000-0000-4000-8000-00000000a51b'::uuid,1,
   'sha256:' || pg_catalog.repeat('b',64),'sha256:' || pg_catalog.repeat('3',64),
   'sha256:' || pg_catalog.repeat('4',64),'u5-bootstrap-validator@1.0.0',true,
   '{"outcome":"PASS"}'::jsonb,'sha256:' || pg_catalog.repeat('d',64),
   '00000000-0000-4000-8000-00000000a502'::uuid);

insert into semantic.ontology_package_preview_bindings (
  app_id,tenant_id,environment,semantic_domain,preview_id,namespace_id,
  package_id,package_version,package_hash,validation_receipt_id,
  validation_receipt_hash,projection_id,projection_storage_digest,
  preview_json,preview_hash,committed_by
) values
  ('00000000-0000-4000-8000-00000000da01'::uuid,
   '00000000-0000-4000-8000-00000000a501'::uuid,'local','commerce',
   '00000000-0000-4000-8000-00000000a53a'::uuid,
   '00000000-0000-4000-8000-00000000a50a'::uuid,
   '00000000-0000-4000-8000-00000000a51a'::uuid,1,
   'sha256:' || pg_catalog.repeat('a',64),
   '00000000-0000-4000-8000-00000000a52a'::uuid,
   'sha256:' || pg_catalog.repeat('c',64),
   '00000000-0000-4000-8000-00000000a54a'::uuid,
   'sha256:' || pg_catalog.repeat('1',64),'{"fixture":"preview-a"}'::jsonb,
   'sha256:' || pg_catalog.repeat('e',64),
   '00000000-0000-4000-8000-00000000a502'::uuid),
  ('00000000-0000-4000-8000-00000000da01'::uuid,
   '00000000-0000-4000-8000-00000000a501'::uuid,'local','commerce',
   '00000000-0000-4000-8000-00000000a53b'::uuid,
   '00000000-0000-4000-8000-00000000a50b'::uuid,
   '00000000-0000-4000-8000-00000000a51b'::uuid,1,
   'sha256:' || pg_catalog.repeat('b',64),
   '00000000-0000-4000-8000-00000000a52b'::uuid,
   'sha256:' || pg_catalog.repeat('d',64),
   '00000000-0000-4000-8000-00000000a54b'::uuid,
   'sha256:' || pg_catalog.repeat('2',64),'{"fixture":"preview-b"}'::jsonb,
   'sha256:' || pg_catalog.repeat('f',64),
   '00000000-0000-4000-8000-00000000a502'::uuid);

insert into semantic.semantic_bootstrap_signer_key_revisions (
  app_id,tenant_id,environment,semantic_domain,key_id,key_revision,
  principal_id,signer_role,key_purpose,key_status,public_material,
  public_material_hash,activation_receipt_hash,revocation_epoch
) values
  ('00000000-0000-4000-8000-00000000da01'::uuid,
   '00000000-0000-4000-8000-00000000a501'::uuid,'local','commerce',
   'workspace-admin-key',1,'00000000-0000-4000-8000-00000000a502'::uuid,
   'WORKSPACE_ADMIN','SEMANTIC_BOOTSTRAP_ADMIN_SIGNATURE','ACTIVE','{"kty":"OKP"}'::jsonb,
   'sha256:' || pg_catalog.repeat('1',64),'sha256:' || pg_catalog.repeat('2',64),0),
  ('00000000-0000-4000-8000-00000000da01'::uuid,
   '00000000-0000-4000-8000-00000000a501'::uuid,'local','commerce',
   'platform-attestor-key',1,'00000000-0000-4000-8000-00000000a503'::uuid,
   'PLATFORM_ATTESTOR','PLATFORM_ATTESTATION','ACTIVE','{"kty":"OKP"}'::jsonb,
   'sha256:' || pg_catalog.repeat('a',64),'sha256:' || pg_catalog.repeat('b',64),0);

grant all on u5_bootstrap_release_documents to
  data_agent_u5_verifier_owner,data_agent_u5_publisher_owner;

select pg_catalog.set_config('data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
select pg_catalog.set_config('data_agent.tenant_id','00000000-0000-4000-8000-00000000a501',true);
select pg_catalog.set_config('data_agent.environment','local',true);
select pg_catalog.set_config('data_agent.principal_id','00000000-0000-4000-8000-00000000a502',true);
select pg_catalog.set_config('data_agent.role','owner',true);
select pg_catalog.set_config('data_agent.deployment_id','00000000-0000-4000-8000-000000000001',true);
select pg_catalog.set_config('app.semantic_domain','commerce',true);

set local role data_agent_u5_verifier_owner;
update u5_bootstrap_release_documents
set policy=semantic.commit_semantic_bootstrap_policy(policy);

do $semantic_bootstrap_packet$
declare v_packet jsonb;
begin
  select pg_catalog.jsonb_build_object(
    'schema_version','semantic-domain-bootstrap-packet@1.0.0',
    'packet_id','00000000-0000-4000-8000-00000000a514',
    'scope',documents.scope,'semantic_domain','commerce',
    'datasource_id','00000000-0000-4000-8000-00000000a519',
    'audience','SEMANTIC_BOOTSTRAP_VERIFIER',
    'candidate_set_root',pg_catalog.jsonb_build_object(
      'candidate_id','00000000-0000-4000-8000-00000000a506',
      'revision_id','00000000-0000-4000-8000-00000000a507',
      'revision',1,'revision_digest','sha256:' || pg_catalog.repeat('8',64),
      'candidate_set_hash','sha256:' || pg_catalog.repeat('9',64)
    ),
    'release_set_id','00000000-0000-4000-8000-00000000a508',
    'policy_ref',pg_catalog.jsonb_build_object(
      'policy_id',documents.policy->>'policy_id',
      'policy_revision',(documents.policy->>'policy_revision')::bigint,
      'policy_hash',documents.policy->>'policy_hash'
    ),
    'nonce_hash','sha256:' || pg_catalog.repeat('d',64),
    'issued_at',pg_catalog.clock_timestamp()-interval '1 minute',
    'expires_at',pg_catalog.clock_timestamp()+interval '1 hour'
  ) into strict v_packet
  from u5_bootstrap_release_documents as documents;
  v_packet:=v_packet||pg_catalog.jsonb_build_object(
    'packet_digest',app_data_agent.u2_canonical_sha256(v_packet)
  );
  update u5_bootstrap_release_documents set packet=v_packet;
end
$semantic_bootstrap_packet$;

update u5_bootstrap_release_documents
set verified_receipt=semantic.commit_verified_semantic_domain_bootstrap(
  pg_catalog.jsonb_build_object(
    'packet',packet,
    'workspace_admin',pg_catalog.jsonb_build_object(
      'principal_id','00000000-0000-4000-8000-00000000a502',
      'key_id','workspace-admin-key','key_revision',1,
      'public_material_hash','sha256:' || pg_catalog.repeat('1',64),
      'activation_receipt_hash','sha256:' || pg_catalog.repeat('2',64),
      'signature_hash','sha256:' || pg_catalog.repeat('3',64)
    ),
    'platform_attestor',pg_catalog.jsonb_build_object(
      'principal_id','00000000-0000-4000-8000-00000000a503',
      'key_id','platform-attestor-key','key_revision',1,
      'public_material_hash','sha256:' || pg_catalog.repeat('a',64),
      'activation_receipt_hash','sha256:' || pg_catalog.repeat('b',64),
      'signature_hash','sha256:' || pg_catalog.repeat('c',64)
    )
  )
);

update u5_bootstrap_release_documents
set grant_result=semantic.create_semantic_bootstrap_publisher_grant(
  pg_catalog.jsonb_build_object(
    'schema_version','semantic-publisher-grant-create-command@1.0.0',
    'command_id','00000000-0000-4000-8000-00000000a515',
    'idempotency_key','u5-grant-fixture-0001','scope',scope,
    'semantic_domain','commerce',
    'issuer',pg_catalog.jsonb_build_object(
      'principal_id','00000000-0000-4000-8000-00000000a502',
      'key_id','workspace-admin-key','key_revision',1
    ),
    'operator_principal_id','00000000-0000-4000-8000-00000000a502',
    'audience','SEMANTIC_BOOTSTRAP_PUBLISHER',
    'release_set_id','00000000-0000-4000-8000-00000000a508',
    'candidate_set_hash','sha256:' || pg_catalog.repeat('9',64),
    'policy_ref',verified_receipt->'policy_ref','revocation_epoch',0,
    'issued_at',pg_catalog.clock_timestamp()-interval '1 minute',
    'expires_at',pg_catalog.clock_timestamp()+interval '1 hour'
  )
);
reset role;

do $semantic_bootstrap_release_material$
declare
  v_validation jsonb;
  v_release_set jsonb;
  v_command jsonb;
begin
  select pg_catalog.jsonb_build_object(
    'schema_version','semantic-bootstrap-validation-receipt@1.0.0',
    'receipt_id','00000000-0000-4000-8000-00000000a50d',
    'scope',documents.scope,'semantic_domain','commerce',
    'candidate_set_root',documents.packet->'candidate_set_root',
    'policy_ref',documents.verified_receipt->'policy_ref',
    'schema_snapshot',pg_catalog.jsonb_build_object(
      'snapshot_id','00000000-0000-4000-8000-00000000a50e',
      'snapshot_revision',1,'snapshot_hash','sha256:' || pg_catalog.repeat('e',64)
    ),
    'source_bundle',pg_catalog.jsonb_build_object(
      'bundle_id','00000000-0000-4000-8000-00000000a50f',
      'bundle_version',1,'bundle_hash','sha256:' || pg_catalog.repeat('f',64)
    ),
    'packages',documents.packages,'outcome','PASS',
    'validator_version','semantic-bootstrap-validator@1.0.0',
    'validated_at',pg_catalog.clock_timestamp()
  ) into strict v_validation
  from u5_bootstrap_release_documents as documents;
  v_validation:=v_validation||pg_catalog.jsonb_build_object(
    'receipt_hash',app_data_agent.u2_canonical_sha256(v_validation)
  );
  select pg_catalog.jsonb_build_object(
    'schema_version','initial-semantic-release-set@1.0.0',
    'release_set_id','00000000-0000-4000-8000-00000000a508',
    'scope',documents.scope,'semantic_domain','commerce',
    'release_id','00000000-0000-4000-8000-00000000a510',
    'generation',1,'base_release_id',null,
    'candidate_set_root',documents.packet->'candidate_set_root',
    'policy_ref',documents.verified_receipt->'policy_ref',
    'validation_ref',pg_catalog.jsonb_build_object(
      'receipt_id',v_validation->>'receipt_id','receipt_hash',v_validation->>'receipt_hash'
    ),
    'packages',documents.packages,
    'runtime_projections',pg_catalog.jsonb_build_object(
      'executable',pg_catalog.jsonb_build_object(
        'projection_id','00000000-0000-4000-8000-00000000a511',
        'projection_hash','sha256:' || pg_catalog.repeat('1',64)
      ),
      'relationship',pg_catalog.jsonb_build_object(
        'projection_id','00000000-0000-4000-8000-00000000a512',
        'projection_hash','sha256:' || pg_catalog.repeat('2',64)
      ),
      'runtime_restriction',pg_catalog.jsonb_build_object(
        'projection_id','00000000-0000-4000-8000-00000000a513',
        'projection_hash','sha256:' || pg_catalog.repeat('3',64)
      )
    ),
    'published_at',pg_catalog.clock_timestamp()
  ) into strict v_release_set
  from u5_bootstrap_release_documents as documents;
  v_release_set:=v_release_set||pg_catalog.jsonb_build_object(
    'release_set_hash',app_data_agent.u2_canonical_sha256(v_release_set)
  );
  select pg_catalog.jsonb_build_object(
    'schema_version','publish-initial-semantic-release-command@1.0.0',
    'command_id','00000000-0000-4000-8000-00000000a516',
    'idempotency_key','u5-publish-fixture-0001','scope',documents.scope,
    'semantic_domain','commerce',
    'verified_domain_ref',pg_catalog.jsonb_build_object(
      'receipt_id',documents.verified_receipt->>'receipt_id',
      'receipt_hash',documents.verified_receipt->>'receipt_hash'
    ),
    'policy_ref',documents.verified_receipt->'policy_ref',
    'grant_ref',documents.grant_result->'grant_ref',
    'validation_ref',v_release_set->'validation_ref','release_set',v_release_set
  ) into strict v_command
  from u5_bootstrap_release_documents as documents;
  update u5_bootstrap_release_documents
  set validation_receipt=v_validation,release_set=v_release_set,publish_command=v_command;
end
$semantic_bootstrap_release_material$;

set local role data_agent_u5_publisher_owner;
update u5_bootstrap_release_documents
set validation_receipt=semantic.commit_semantic_bootstrap_validation(validation_receipt);

do $semantic_bootstrap_first_publish$
declare
  v_command jsonb;
  v_created jsonb;
  v_replayed jsonb;
  v_changed jsonb;
  v_release_count bigint;
  v_binding_count bigint;
  v_outbox_count bigint;
begin
  select documents.publish_command into strict v_command
  from u5_bootstrap_release_documents as documents;

  begin
    perform semantic.publish_initial_semantic_release_set(
      pg_catalog.jsonb_set(v_command,'{validation_ref,receipt_hash}',pg_catalog.to_jsonb(
        'sha256:' || pg_catalog.repeat('0',64)
      ))
    );
    raise exception 'SEMANTIC_BOOTSTRAP_STALE_VALIDATION_WAS_NOT_REJECTED';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'SEMANTIC_BOOTSTRAP_VALIDATION_STALE' then raise; end if;
  end;
  if (select pg_catalog.count(*) from semantic.initial_semantic_release_sets)<>0
    or (select pg_catalog.count(*) from semantic.semantic_bootstrap_capability_tombstones)<>0
  then
    raise exception 'SEMANTIC_BOOTSTRAP_FAILED_ATTEMPT_MUTATED_AUTHORITY';
  end if;

  v_created:=semantic.publish_initial_semantic_release_set(v_command);
  v_release_count:=(select pg_catalog.count(*) from semantic.initial_semantic_release_sets);
  v_binding_count:=(select pg_catalog.count(*) from semantic.initial_semantic_release_package_bindings);
  v_outbox_count:=(select pg_catalog.count(*) from semantic.semantic_bootstrap_outbox);
  v_replayed:=semantic.publish_initial_semantic_release_set(v_command);
  if v_created->>'disposition'<>'CREATED' or v_replayed->>'disposition'<>'REPLAYED'
    or v_created->>'request_hash'<>v_replayed->>'request_hash'
    or v_release_count<>1 or v_binding_count<>2 or v_outbox_count<>1
    or (select pg_catalog.count(*) from semantic.initial_semantic_release_sets)<>v_release_count
    or (select pg_catalog.count(*) from semantic.initial_semantic_release_package_bindings)<>v_binding_count
    or (select pg_catalog.count(*) from semantic.semantic_bootstrap_outbox)<>v_outbox_count
  then
    raise exception 'SEMANTIC_BOOTSTRAP_PUBLISH_REPLAY_ASSERTION_FAILED';
  end if;

  v_changed:=pg_catalog.jsonb_set(v_command,'{command_id}',
    '"00000000-0000-4000-8000-00000000a599"'::jsonb);
  begin
    perform semantic.publish_initial_semantic_release_set(v_changed);
    raise exception 'SEMANTIC_BOOTSTRAP_IDEMPOTENCY_CONFLICT_WAS_NOT_REJECTED';
  exception when unique_violation then
    if sqlerrm <> 'SEMANTIC_BOOTSTRAP_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;

  v_changed:=pg_catalog.jsonb_set(v_command,'{idempotency_key}',
    '"u5-publish-fixture-0002"'::jsonb);
  begin
    perform semantic.publish_initial_semantic_release_set(v_changed);
    raise exception 'SEMANTIC_BOOTSTRAP_TOMBSTONE_WAS_NOT_ENFORCED';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'SEMANTIC_BOOTSTRAP_CAPABILITY_CLOSED' then raise; end if;
  end;

  if not exists (
    select 1 from semantic.semantic_active_pointer as pointer
    where pointer.tenant_id='00000000-0000-4000-8000-00000000a501'::uuid
      and pointer.semantic_domain='commerce'
      and pointer.current_release_id='00000000-0000-4000-8000-00000000a510'::uuid
      and pointer.current_release_generation=1
  ) or not exists (
    select 1 from semantic.semantic_runtime_activation as activation
    where activation.tenant_id='00000000-0000-4000-8000-00000000a501'::uuid
      and activation.semantic_domain='commerce'
      and activation.runtime_mode='PUBLISHED_ONLY'
      and activation.current_release_generation=1
  ) or not exists (
    select 1 from semantic.semantic_bootstrap_publisher_grants as publisher_grant
    where publisher_grant.tenant_id='00000000-0000-4000-8000-00000000a501'::uuid
      and publisher_grant.semantic_domain='commerce'
      and publisher_grant.grant_status='CONSUMED'
  ) or (select pg_catalog.count(*) from semantic.semantic_package_admission_receipts)<>2
    or (select pg_catalog.count(*) from semantic.first_release_admission_receipts)<>1
    or (select pg_catalog.count(*) from semantic.semantic_bootstrap_capability_tombstones)<>1
  then
    raise exception 'SEMANTIC_BOOTSTRAP_FIRST_RELEASE_CLOSURE_ASSERTION_FAILED';
  end if;

  update u5_bootstrap_release_documents set publish_result=v_created;
end
$semantic_bootstrap_first_publish$;
reset role;

-- Characterize the ordinary, human-reviewed generation >= 2 path after the
-- one-time bootstrap capability has been consumed. Publish v2, roll back to
-- v1, then roll forward to the already-reviewed v2 release.
create temporary table u5_human_governance_results (
  prepare_result jsonb,
  commit_result jsonb,
  rollback_result jsonb,
  rollforward_result jsonb
) on commit drop;
insert into u5_human_governance_results default values;
grant all on u5_human_governance_results to data_agent_backend;

insert into semantic.semantic_candidate (
  app_id,tenant_id,environment,semantic_domain,candidate_id,proposer_principal,
  current_revision_id,candidate_status
) values (
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000a501'::uuid,'local','commerce',
  '00000000-0000-4000-8000-00000000a560'::uuid,
  '00000000-0000-4000-8000-00000000a502',
  '00000000-0000-4000-8000-00000000a561'::uuid,'APPROVED'
);
insert into semantic.semantic_candidate_revision (
  app_id,tenant_id,environment,semantic_domain,candidate_id,revision_id,
  revision_number,source_revision_id,revision_payload,revision_digest,
  author_principal,change_class
) values (
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000a501'::uuid,'local','commerce',
  '00000000-0000-4000-8000-00000000a560'::uuid,
  '00000000-0000-4000-8000-00000000a561'::uuid,1,
  '00000000-0000-4000-8000-00000000a505'::uuid,
  '{"base_release_generation":1,"fixture":"human-v2"}'::jsonb,
  'sha256:' || pg_catalog.repeat('6',64),
  '00000000-0000-4000-8000-00000000a502','MAJOR'
);
insert into semantic.semantic_review_task (
  app_id,tenant_id,environment,semantic_domain,packet_id,packet_kind,
  approval_mode,packet_digest,packet_payload,candidate_id,
  decision_window_status,review_outcome,decision_expires_at,publish_expires_at,
  quorum_rules_snapshot,veto_rules_snapshot,created_by,closed_at
) values (
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000a501'::uuid,'local','commerce',
  '00000000-0000-4000-8000-00000000a562'::uuid,'CANDIDATE_REVIEW',
  'HUMAN_REVIEW','sha256:' || pg_catalog.repeat('7',64),
  '{"base_release_generation":1}'::jsonb,
  '00000000-0000-4000-8000-00000000a560'::uuid,
  'CLOSED','APPROVED',pg_catalog.clock_timestamp()+interval '1 hour',
  pg_catalog.clock_timestamp()+interval '1 hour','{"required_approvals":1}'::jsonb,
  '{"veto_roles":["security_reviewer"]}'::jsonb,'u5-human-fixture',pg_catalog.clock_timestamp()
);
insert into semantic.semantic_review_decision (
  app_id,tenant_id,environment,semantic_domain,packet_id,decision_id,
  principal,semantic_role,decision,decision_reason,decision_digest
) values (
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000a501'::uuid,'local','commerce',
  '00000000-0000-4000-8000-00000000a562'::uuid,
  '00000000-0000-4000-8000-00000000a563'::uuid,
  '00000000-0000-4000-8000-00000000a502','domain_reviewer','APPROVE',
  'U5 human v2 characterization','sha256:' || pg_catalog.repeat('8',64)
);

set local role data_agent_backend;
update u5_human_governance_results set prepare_result=semantic.human_prepare_publish_attempt(
  pg_catalog.jsonb_build_object(
    'schema_version','human-prepare-publish-attempt@1.0.0',
    'scope',pg_catalog.jsonb_build_object(
      'app_id','00000000-0000-4000-8000-00000000da01',
      'tenant_id','00000000-0000-4000-8000-00000000a501',
      'workspace_id','00000000-0000-4000-8000-00000000a501','environment','local'
    ),
    'semantic_domain','commerce','packet_id','00000000-0000-4000-8000-00000000a562',
    'candidate_id','00000000-0000-4000-8000-00000000a560',
    'compiler_bundle_digest','sha256:' || pg_catalog.repeat('6',64),
    'catalog_fence_epoch',0,'dependency_generation',0,'target_generation',2,
    'idempotency_digest','sha256:' || pg_catalog.repeat('7',64),
    'conditional_legacy_plan',null
  )
);
update u5_human_governance_results set commit_result=semantic.human_commit_publish_attempt(
  pg_catalog.jsonb_build_object(
    'schema_version','human-commit-publish-attempt@1.0.0',
    'scope',pg_catalog.jsonb_build_object(
      'app_id','00000000-0000-4000-8000-00000000da01',
      'tenant_id','00000000-0000-4000-8000-00000000a501',
      'workspace_id','00000000-0000-4000-8000-00000000a501','environment','local'
    ),
    'semantic_domain','commerce','attempt_id',prepare_result->>'attempt_id',
    'executable_projection_ref','00000000-0000-4000-8000-00000000a571',
    'executable_projection_hash','sha256:' || pg_catalog.repeat('1',64),
    'relationship_projection_ref','00000000-0000-4000-8000-00000000a572',
    'relationship_projection_hash','sha256:' || pg_catalog.repeat('2',64),
    'runtime_restriction_projection_ref','00000000-0000-4000-8000-00000000a573',
    'runtime_restriction_projection_hash','sha256:' || pg_catalog.repeat('3',64),
    'profile_child_manifest',null,'committed_legacy_attempt_ref',null
  )
);
reset role;

do $semantic_human_v2_committed$
declare v_release_id uuid;
begin
  select (results.commit_result->>'release_id')::uuid into strict v_release_id
  from u5_human_governance_results as results;
  if not exists (
    select 1 from semantic.semantic_source_release as release
    where release.release_id=v_release_id and release.release_generation=2
      and release.approval_mode='HUMAN_REVIEW'
      and release.quorum_snapshot='{"required_approvals":1}'::jsonb
      and release.decision_set_digest<>'sha256:' || pg_catalog.repeat('0',64)
  ) or not exists (
    select 1 from semantic.semantic_active_pointer as pointer
    where pointer.tenant_id='00000000-0000-4000-8000-00000000a501'::uuid
      and pointer.semantic_domain='commerce' and pointer.current_release_id=v_release_id
      and pointer.current_release_generation=2
  ) then
    raise exception 'SEMANTIC_HUMAN_V2_PUBLISH_CHARACTERIZATION_FAILED';
  end if;
end
$semantic_human_v2_committed$;

insert into semantic.semantic_review_task (
  app_id,tenant_id,environment,semantic_domain,packet_id,packet_kind,
  approval_mode,packet_digest,packet_payload,decision_window_status,review_outcome,
  decision_expires_at,publish_expires_at,quorum_rules_snapshot,veto_rules_snapshot,
  created_by,closed_at
) values
  ('00000000-0000-4000-8000-00000000da01'::uuid,
   '00000000-0000-4000-8000-00000000a501'::uuid,'local','commerce',
   '00000000-0000-4000-8000-00000000a580'::uuid,'ROLLBACK_REVIEW','HUMAN_REVIEW',
   'sha256:' || pg_catalog.repeat('a',64),'{"direction":"rollback"}'::jsonb,
   'CLOSED','APPROVED',pg_catalog.clock_timestamp()+interval '1 hour',
   pg_catalog.clock_timestamp()+interval '1 hour','{"required_approvals":1}'::jsonb,
   '{"veto_roles":["security_reviewer"]}'::jsonb,'u5-human-fixture',pg_catalog.clock_timestamp()),
  ('00000000-0000-4000-8000-00000000da01'::uuid,
   '00000000-0000-4000-8000-00000000a501'::uuid,'local','commerce',
   '00000000-0000-4000-8000-00000000a581'::uuid,'ROLLBACK_REVIEW','HUMAN_REVIEW',
   'sha256:' || pg_catalog.repeat('b',64),'{"direction":"rollforward"}'::jsonb,
   'CLOSED','APPROVED',pg_catalog.clock_timestamp()+interval '1 hour',
   pg_catalog.clock_timestamp()+interval '1 hour','{"required_approvals":1}'::jsonb,
   '{"veto_roles":["security_reviewer"]}'::jsonb,'u5-human-fixture',pg_catalog.clock_timestamp());

insert into semantic.semantic_rollback_authorization (
  app_id,tenant_id,environment,semantic_domain,authorization_id,packet_id,
  from_release_id,from_release_generation,to_release_id,to_release_generation,
  current_release_id,current_release_generation,authorization_digest,
  decision_set_digest,nonce,expires_at
) select
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000a501'::uuid,'local','commerce',
  '00000000-0000-4000-8000-00000000a582'::uuid,
  '00000000-0000-4000-8000-00000000a580'::uuid,
  (results.commit_result->>'release_id')::uuid,2,
  '00000000-0000-4000-8000-00000000a510'::uuid,1,
  (results.commit_result->>'release_id')::uuid,2,
  'sha256:' || pg_catalog.repeat('c',64),'sha256:' || pg_catalog.repeat('d',64),
  '00000000-0000-4000-8000-00000000a583'::uuid,
  pg_catalog.clock_timestamp()+interval '1 hour'
from u5_human_governance_results as results;

set local role data_agent_backend;
update u5_human_governance_results set rollback_result=semantic.human_execute_rollback(
  pg_catalog.jsonb_build_object(
    'schema_version','human-execute-rollback@1.0.0',
    'scope',pg_catalog.jsonb_build_object(
      'app_id','00000000-0000-4000-8000-00000000da01',
      'tenant_id','00000000-0000-4000-8000-00000000a501',
      'workspace_id','00000000-0000-4000-8000-00000000a501','environment','local'
    ),
    'semantic_domain','commerce','authorization_id','00000000-0000-4000-8000-00000000a582',
    'nonce','00000000-0000-4000-8000-00000000a583','rollback_reason','U5_CHARACTERIZATION'
  )
);
reset role;

insert into semantic.semantic_rollback_authorization (
  app_id,tenant_id,environment,semantic_domain,authorization_id,packet_id,
  from_release_id,from_release_generation,to_release_id,to_release_generation,
  current_release_id,current_release_generation,authorization_digest,
  decision_set_digest,nonce,expires_at
) select
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000a501'::uuid,'local','commerce',
  '00000000-0000-4000-8000-00000000a584'::uuid,
  '00000000-0000-4000-8000-00000000a581'::uuid,
  '00000000-0000-4000-8000-00000000a510'::uuid,1,
  (results.commit_result->>'release_id')::uuid,2,
  '00000000-0000-4000-8000-00000000a510'::uuid,1,
  'sha256:' || pg_catalog.repeat('e',64),'sha256:' || pg_catalog.repeat('f',64),
  '00000000-0000-4000-8000-00000000a585'::uuid,
  pg_catalog.clock_timestamp()+interval '1 hour'
from u5_human_governance_results as results;

set local role data_agent_backend;
update u5_human_governance_results set rollforward_result=semantic.human_execute_rollback(
  pg_catalog.jsonb_build_object(
    'schema_version','human-execute-rollback@1.0.0',
    'scope',pg_catalog.jsonb_build_object(
      'app_id','00000000-0000-4000-8000-00000000da01',
      'tenant_id','00000000-0000-4000-8000-00000000a501',
      'workspace_id','00000000-0000-4000-8000-00000000a501','environment','local'
    ),
    'semantic_domain','commerce','authorization_id','00000000-0000-4000-8000-00000000a584',
    'nonce','00000000-0000-4000-8000-00000000a585','rollback_reason','U5_ROLLFORWARD_CHARACTERIZATION'
  )
);
reset role;

do $semantic_human_rollback_rollforward$
declare v_release_id uuid;
begin
  select (results.commit_result->>'release_id')::uuid into strict v_release_id
  from u5_human_governance_results as results;
  if (select pg_catalog.count(*) from semantic.semantic_rollback_receipt)<>2
    or not exists (
      select 1 from semantic.semantic_active_pointer as pointer
      where pointer.tenant_id='00000000-0000-4000-8000-00000000a501'::uuid
        and pointer.semantic_domain='commerce' and pointer.current_release_id=v_release_id
        and pointer.current_release_generation=2
    ) or not exists (
      select 1 from semantic.semantic_runtime_activation as activation
      where activation.tenant_id='00000000-0000-4000-8000-00000000a501'::uuid
        and activation.semantic_domain='commerce' and activation.current_release_id=v_release_id
        and activation.current_release_generation=2
    ) then
    raise exception 'SEMANTIC_HUMAN_ROLLBACK_ROLLFORWARD_CHARACTERIZATION_FAILED';
  end if;
end
$semantic_human_rollback_rollforward$;

rollback;

do $semantic_bootstrap_fixture_rolled_back$
begin
  if exists (
    select 1 from app_data_agent.workspaces
    where workspace_id='00000000-0000-4000-8000-00000000a501'::uuid
  ) or exists (
    select 1 from semantic.initial_semantic_release_sets
    where tenant_id='00000000-0000-4000-8000-00000000a501'::uuid
  ) then
    raise exception 'SEMANTIC_BOOTSTRAP_FIXTURE_ROLLBACK_FAILED';
  end if;
end
$semantic_bootstrap_fixture_rolled_back$;
