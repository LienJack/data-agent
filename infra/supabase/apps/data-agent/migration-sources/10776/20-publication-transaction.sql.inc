create function app_data_agent.commit_e1_analysis_publication(envelope_json jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare
  command_json jsonb;scope_json jsonb;node_json jsonb;authority_json jsonb;
  journal_json jsonb;oracle_json jsonb;binding_json jsonb;l2_json jsonb;
  candidate_json jsonb;candidate_envelope jsonb;candidate_payload jsonb;chart_json jsonb;
  report_json jsonb;stage_record record;oracle_record record;explanation_record record;
  staged_artifact record;existing record;target_attempt record;target_outbox record;
  reference_json jsonb;receipt_ref jsonb;node_references jsonb;all_references jsonb:='[]'::jsonb;
  artifact_bindings jsonb:='[]'::jsonb;receipt_json jsonb;journal_result jsonb;
  input_hash text;computed_hash text;db_now timestamptz;committed_at text;
  derived_count integer:=0;completion_count integer:=0;chart_count integer:=0;
  node_count integer;ordinal_value integer:=0;binding_item jsonb;
begin
  command_json:=envelope_json->'command';scope_json:=command_json->'scope';
  if envelope_json->>'protocol_version' is distinct from 'u6-db-command@1.0.0'
    or pg_catalog.jsonb_typeof(command_json) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command_json,array[
      'schema_version','scope','run_id','principal_id','attempt_id','worker_fence',
      'idempotency_key','analysis_program_ref','nodes','l2_artifact_commands',
      'chart_documents','report_document','public_event_id','publication_hash']::text[])
      is distinct from true
    or command_json->>'schema_version' is distinct from 'e1-analysis-publication@1.0.0'
    or pg_catalog.jsonb_typeof(scope_json) is distinct from 'object'
    or pg_catalog.jsonb_typeof(command_json->'nodes') is distinct from 'array'
    or pg_catalog.jsonb_typeof(command_json->'l2_artifact_commands') is distinct from 'array'
    or pg_catalog.jsonb_typeof(command_json->'chart_documents') is distinct from 'array'
    or pg_catalog.jsonb_typeof(command_json->'report_document') is distinct from 'object'
    or app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'hash_domain','e1-analysis-publication@1.0.0','value',command_json-'publication_hash'))
      is distinct from command_json->>'publication_hash'
    or app_data_agent.contains_potential_plaintext_secret(command_json)
  then return pg_catalog.jsonb_build_object(
    'ok',false,'error_code','E1_ANALYSIS_PUBLICATION_CONTRACT_INVALID'); end if;

  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,'RESEARCH_ARTIFACT_AUTHORITY','EVIDENCE',null,null,true);
  perform app_data_agent.assert_analysis_lifecycle_fence(envelope_json,command_json);

  select source.* into existing from app_data_agent.e1_analysis_publications source
  where source.app_id=(scope_json->>'app_id')::uuid
    and source.tenant_id=(scope_json->>'tenant_id')::uuid
    and source.environment=scope_json->>'environment'
    and source.run_id=(command_json->>'run_id')::uuid
    and source.principal_id=(command_json->>'principal_id')::uuid
    and source.idempotency_key=command_json->>'idempotency_key';
  if existing.publication_hash is not null then
    if existing.publication_hash is distinct from command_json->>'publication_hash'
    then return pg_catalog.jsonb_build_object(
      'ok',false,'error_code','E1_ANALYSIS_PUBLICATION_IDEMPOTENCY_CONFLICT'); end if;
    receipt_json:=pg_catalog.jsonb_set(existing.receipt_json,'{created}','false'::jsonb);
    return pg_catalog.jsonb_build_object('ok',true,'receipt',receipt_json);
  end if;

  select attempt.*,outbox.outbox_id into target_attempt
  from app_data_agent.run_attempts attempt
  join app_data_agent.outbox outbox
    on outbox.app_id=attempt.app_id and outbox.tenant_id=attempt.tenant_id
    and outbox.environment=attempt.environment and outbox.run_id=attempt.run_id
    and outbox.outbox_id=attempt.outbox_id
  where attempt.app_id=(scope_json->>'app_id')::uuid
    and attempt.tenant_id=(scope_json->>'tenant_id')::uuid
    and attempt.environment=scope_json->>'environment'
    and attempt.run_id=(command_json->>'run_id')::uuid
    and attempt.attempt_id=(command_json->>'attempt_id')::uuid
  for update of attempt,outbox;
  db_now:=pg_catalog.clock_timestamp();
  if target_attempt.attempt_id is null or target_attempt.status<>'ACTIVE'
    or target_attempt.worker_fence<>(command_json->>'worker_fence')::bigint
    or target_attempt.lease_expires_at<=db_now
  then return pg_catalog.jsonb_build_object(
    'ok',false,'error_code','RESEARCH_AUTHORITY_FENCE_MISMATCH'); end if;

  node_count:=pg_catalog.jsonb_array_length(command_json->'nodes');
  if node_count<1 or node_count>64
  then return pg_catalog.jsonb_build_object(
    'ok',false,'error_code','E1_ANALYSIS_PUBLICATION_NODE_CLOSURE_INVALID'); end if;

  begin
    for node_json in select value from pg_catalog.jsonb_array_elements(command_json->'nodes') loop
      authority_json:=node_json->'authority_commit';journal_json:=node_json->'journal_command';
      oracle_json:=node_json->'oracle_receipt';
      if authority_json->>'schema_version'<>'analysis-authority-commit@1.0.0'
        or journal_json->'event'->>'event_type'<>'AUTHORITY_COMMITTED'
        or journal_json->'event'->>'stage_id'<>authority_json->>'stage_id'
        or journal_json->'event'->>'authority_commit_hash'<>authority_json->>'authority_commit_hash'
        or oracle_json->>'schema_version'<>'analysis-oracle-receipt@1.0.0'
        or oracle_json->>'verdict'<>'PASS' or oracle_json->>'expected_terminal'<>'READY'
        or oracle_json->>'node_id'<>authority_json->>'node_id'
        or oracle_json->'input_binding'->>'stage_id'<>authority_json->>'stage_id'
        or oracle_json->'input_binding'->>'stage_hash'<>authority_json->>'stage_hash'
        or oracle_json->'input_binding'->>'published_closure_hash'<>authority_json->>'closure_hash'
        or oracle_json->'input_binding'->>'operator_receipt_closure_hash'
          <>authority_json->>'operator_receipt_closure_hash'
        or app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
          'hash_domain','analysis-oracle-receipt@1.0.0','value',oracle_json-'receipt_hash'))
          <>oracle_json->>'receipt_hash'
        or authority_json->'oracle_receipt_payload'->'oracle_receipt'->>'receipt_hash'
          <>oracle_json->>'receipt_hash'
        or app_data_agent.u2_canonical_sha256(authority_json->'oracle_receipt_payload')
          <>authority_json->>'oracle_receipt_hash'
        or app_data_agent.u2_canonical_sha256(authority_json->'explanation')
          <>authority_json->>'explanation_hash'
        or app_data_agent.u2_canonical_sha256(authority_json->'sandbox_receipt_payload')
          <>authority_json->>'sandbox_receipt_hash'
        or app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
          'hash_domain','analysis-authority-commit@1.0.0',
          'value',authority_json-'authority_commit_hash'))
          <>authority_json->>'authority_commit_hash'
      then raise exception using errcode='P0001',message='E1_ANALYSIS_PUBLICATION_NODE_INVALID'; end if;

      select source.* into stage_record from app_data_agent.analysis_result_stages source
      where source.app_id=(scope_json->>'app_id')::uuid
        and source.tenant_id=(scope_json->>'tenant_id')::uuid
        and source.environment=scope_json->>'environment'
        and source.run_id=(command_json->>'run_id')::uuid
        and source.node_id=authority_json->>'node_id'
        and source.attempt_id=(command_json->>'attempt_id')::uuid
        and source.worker_fence=(command_json->>'worker_fence')::bigint
        and source.stage_id=(authority_json->>'stage_id')::uuid
        and source.stage_hash=authority_json->>'stage_hash'
        and source.closure_hash=authority_json->>'closure_hash'
        and source.expires_at>db_now for share of source;
      select source.* into oracle_record from app_data_agent.analysis_stage_oracle_records source
      where source.app_id=stage_record.app_id and source.tenant_id=stage_record.tenant_id
        and source.environment=stage_record.environment and source.run_id=stage_record.run_id
        and source.node_id=stage_record.node_id and source.attempt_id=stage_record.attempt_id
        and source.context_generation=stage_record.context_generation
        and source.stage_id=stage_record.stage_id for share of source;
      select source.* into explanation_record from app_data_agent.analysis_stage_explanation_records source
      where source.app_id=stage_record.app_id and source.tenant_id=stage_record.tenant_id
        and source.environment=stage_record.environment and source.run_id=stage_record.run_id
        and source.node_id=stage_record.node_id and source.attempt_id=stage_record.attempt_id
        and source.context_generation=stage_record.context_generation
        and source.stage_id=stage_record.stage_id for share of source;
      if stage_record.stage_id is null or oracle_record.stage_id is null
        or explanation_record.stage_id is null
        or oracle_record.receipt_hash<>authority_json->>'oracle_receipt_hash'
        or oracle_record.receipt_payload<>authority_json->'oracle_receipt_payload'
        or explanation_record.explanation_hash<>authority_json->>'explanation_hash'
        or explanation_record.explanation<>authority_json->'explanation'
        or stage_record.command_json->'operator_finalization'->>'operator_receipt_closure_hash'
          <>authority_json->>'operator_receipt_closure_hash'
      then raise exception using errcode='P0001',message='E1_ANALYSIS_PUBLICATION_STAGE_INVALID'; end if;

      node_references:='[]'::jsonb;
      for binding_json in select value from pg_catalog.jsonb_array_elements(authority_json->'output_bindings') loop
        select source.* into staged_artifact
        from app_data_agent.analysis_result_stage_artifacts source
        where source.app_id=stage_record.app_id and source.tenant_id=stage_record.tenant_id
          and source.environment=stage_record.environment and source.run_id=stage_record.run_id
          and source.node_id=stage_record.node_id and source.attempt_id=stage_record.attempt_id
          and source.context_generation=stage_record.context_generation
          and source.stage_id=stage_record.stage_id
          and source.artifact_name=binding_json->'stage_artifact'->>'artifact_name';
        reference_json:=binding_json->'reference';
        if staged_artifact.artifact_name is null
          or staged_artifact.content_sha256<>reference_json->>'content_hash'
          or staged_artifact.content_sha256<>binding_json->'stage_artifact'->>'content_sha256'
        then raise exception using errcode='P0001',message='E1_ANALYSIS_PUBLICATION_OUTPUT_INVALID'; end if;
        input_hash:=app_data_agent.u6_domain_sha256('analysis-system-artifact-input@1.0.0',
          pg_catalog.jsonb_build_object('command',binding_json,'content_hash',staged_artifact.content_sha256));
        insert into app_data_agent.analysis_system_artifacts(
          app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,
          principal_id,idempotency_key,attempt_id,worker_fence,input_hash,payload_json,content_bytes)
        values(stage_record.app_id,stage_record.tenant_id,stage_record.environment,stage_record.run_id,
          (reference_json->>'artifact_id')::uuid,'SandboxResult',1,staged_artifact.content_sha256,
          (command_json->>'principal_id')::uuid,(authority_json->>'idempotency_key')||':'||staged_artifact.artifact_name,
          stage_record.attempt_id,stage_record.worker_fence,input_hash,
          pg_catalog.jsonb_build_object('stage_id',stage_record.stage_id,'artifact',binding_json->'stage_artifact'),
          staged_artifact.content_bytes);
        node_references:=node_references||pg_catalog.jsonb_build_array(reference_json);
        all_references:=all_references||pg_catalog.jsonb_build_array(reference_json);
        artifact_bindings:=artifact_bindings||pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('role','SANDBOX_RESULT','reference',reference_json));
      end loop;
      receipt_ref:=authority_json->'sandbox_receipt_ref';
      input_hash:=app_data_agent.u6_domain_sha256('analysis-system-artifact-input@1.0.0',
        pg_catalog.jsonb_build_object('command',authority_json->'sandbox_receipt_payload',
          'content_hash',authority_json->>'sandbox_receipt_hash'));
      insert into app_data_agent.analysis_system_artifacts(
        app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,
        principal_id,idempotency_key,attempt_id,worker_fence,input_hash,payload_json,content_bytes)
      values(stage_record.app_id,stage_record.tenant_id,stage_record.environment,stage_record.run_id,
        (receipt_ref->>'artifact_id')::uuid,'SandboxExecutionReceipt',1,authority_json->>'sandbox_receipt_hash',
        (command_json->>'principal_id')::uuid,(authority_json->>'idempotency_key')||':receipt',
        stage_record.attempt_id,stage_record.worker_fence,input_hash,
        authority_json->'sandbox_receipt_payload',null);
      node_references:=node_references||pg_catalog.jsonb_build_array(receipt_ref);
      all_references:=all_references||pg_catalog.jsonb_build_array(receipt_ref);
      artifact_bindings:=artifact_bindings||pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('role','SANDBOX_RECEIPT','reference',receipt_ref));
      receipt_json:=pg_catalog.jsonb_build_object(
        'schema_version','analysis-authority-commit-receipt@1.0.0','created',true,
        'authority_commit_hash',authority_json->>'authority_commit_hash',
        'stage_id',authority_json->>'stage_id','stage_hash',authority_json->>'stage_hash',
        'references',node_references,'public_event_id',authority_json->>'public_event_id');
      insert into app_data_agent.analysis_authority_commits(
        app_id,tenant_id,environment,run_id,node_id,stage_id,principal_id,attempt_id,
        worker_fence,idempotency_key,authority_commit_hash,command_json,receipt_json)
      values(stage_record.app_id,stage_record.tenant_id,stage_record.environment,stage_record.run_id,
        stage_record.node_id,stage_record.stage_id,(command_json->>'principal_id')::uuid,
        stage_record.attempt_id,stage_record.worker_fence,authority_json->>'idempotency_key',
        authority_json->>'authority_commit_hash',authority_json,receipt_json);
      insert into app_data_agent.analysis_authority_current(
        app_id,tenant_id,environment,run_id,node_id,stage_id,stage_hash,
        authority_commit_hash,public_event_id,committed_at)
      values(stage_record.app_id,stage_record.tenant_id,stage_record.environment,stage_record.run_id,
        stage_record.node_id,stage_record.stage_id,stage_record.stage_hash,
        authority_json->>'authority_commit_hash',(authority_json->>'public_event_id')::uuid,db_now);
      journal_result:=app_data_agent.append_analysis_context_journal(pg_catalog.jsonb_build_object(
        'protocol_version','u6-db-command@1.0.0',
        'authority_capability_id',envelope_json->>'authority_capability_id','command',journal_json));
      if (journal_result->>'ok')::boolean is distinct from true
      then raise exception using errcode='P0001',message='E1_ANALYSIS_PUBLICATION_JOURNAL_REJECTED'; end if;
    end loop;

    for l2_json in select value from pg_catalog.jsonb_array_elements(command_json->'l2_artifact_commands') loop
      candidate_json:=l2_json->'candidate';candidate_envelope:=candidate_json->'envelope';
      candidate_payload:=candidate_json->'payload';
      if candidate_payload->>'artifact_type'='DerivedAnalysisEvidence' then
        derived_count:=derived_count+1;
      elsif candidate_payload->>'artifact_type'='AnalysisCompletionReceipt'
        and candidate_payload->>'terminal'='READY' then completion_count:=completion_count+1;
      else raise exception using errcode='P0001',message='E1_ANALYSIS_PUBLICATION_L2_TYPE_INVALID'; end if;
      computed_hash:=app_data_agent.runtime_canonical_sha256(pg_catalog.jsonb_build_object(
        'envelope',candidate_envelope-'content_hash'-'created_at'-'status','payload',candidate_payload));
      if computed_hash<>candidate_envelope->>'content_hash'
        or candidate_envelope->>'status'<>'CANDIDATE'
        or candidate_envelope->>'run_id'<>command_json->>'run_id'
      then raise exception using errcode='P0001',message='E1_ANALYSIS_PUBLICATION_L2_HASH_INVALID'; end if;
      committed_at:=pg_catalog.to_char(db_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
      candidate_json:=pg_catalog.jsonb_set(pg_catalog.jsonb_set(candidate_json,
        '{envelope,status}','"COMMITTED"'::jsonb,false),'{envelope,created_at}',
        pg_catalog.to_jsonb(committed_at),false);
      insert into app_data_agent.artifacts(
        app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,
        document_json,worker_fence,is_active,parent_revision,parent_content_hash,created_at)
      values((scope_json->>'app_id')::uuid,(scope_json->>'tenant_id')::uuid,
        scope_json->>'environment',(command_json->>'run_id')::uuid,
        (candidate_envelope->>'artifact_id')::uuid,candidate_envelope->>'artifact_type',1,
        candidate_envelope->>'content_hash',candidate_json,(command_json->>'worker_fence')::bigint,
        true,null,null,db_now);
      reference_json:=pg_catalog.jsonb_build_object(
        'artifact_id',candidate_envelope->>'artifact_id','artifact_type',candidate_envelope->>'artifact_type',
        'app_id',scope_json->>'app_id','tenant_id',scope_json->>'tenant_id',
        'environment',scope_json->>'environment','run_id',command_json->>'run_id',
        'revision',1,'content_hash',candidate_envelope->>'content_hash');
      all_references:=all_references||pg_catalog.jsonb_build_array(reference_json);
      artifact_bindings:=artifact_bindings||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'role',case candidate_envelope->>'artifact_type' when 'DerivedAnalysisEvidence'
          then 'DERIVED_EVIDENCE' else 'COMPLETION_READY' end,'reference',reference_json));
    end loop;
    if derived_count<>node_count or completion_count<>1
    then raise exception using errcode='P0001',message='E1_ANALYSIS_PUBLICATION_READY_CLOSURE_INVALID'; end if;

    for chart_json in select value from pg_catalog.jsonb_array_elements(command_json->'chart_documents') loop
      reference_json:=chart_json->'document_ref';
      computed_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
        'schema_version',chart_json->'schema_version','document_ref',(chart_json->'document_ref')-'content_hash',
        'source_refs',chart_json->'source_refs','provenance',chart_json->'provenance','projection',chart_json->'projection'));
      if chart_json->>'schema_version'<>'artifact-workspace-chart-document@3.0.0'
        or computed_hash<>reference_json->>'content_hash'
      then raise exception using errcode='P0001',message='E1_ANALYSIS_PUBLICATION_CHART_INVALID'; end if;
      insert into app_data_agent.artifacts(
        app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,
        document_json,worker_fence,is_active,parent_revision,parent_content_hash,created_at)
      values((scope_json->>'app_id')::uuid,(scope_json->>'tenant_id')::uuid,
        scope_json->>'environment',(command_json->>'run_id')::uuid,
        (reference_json->>'artifact_id')::uuid,'ArtifactWorkspaceDocument',1,
        reference_json->>'content_hash',chart_json,(command_json->>'worker_fence')::bigint,
        true,null,null,db_now);
      chart_count:=chart_count+1;
      all_references:=all_references||pg_catalog.jsonb_build_array(reference_json);
      artifact_bindings:=artifact_bindings||pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('role','CHART','reference',reference_json));
    end loop;
    if chart_count<1 then raise exception using errcode='P0001',message='E1_ANALYSIS_PUBLICATION_CHART_REQUIRED'; end if;

    report_json:=command_json->'report_document';reference_json:=report_json->'artifact_ref';
    computed_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'schema_version',report_json->'schema_version','artifact_ref',(report_json->'artifact_ref')-'content_hash',
      'profile_id',report_json->'profile_id','task_id',report_json->'task_id',
      'source_refs',report_json->'source_refs','provenance',report_json->'provenance',
      'projection',report_json->'projection','committed_at',report_json->'committed_at'));
    if report_json->>'schema_version'<>'product-team-artifact@2.0.0'
      or reference_json->>'artifact_type'<>'AnalysisReport'
      or computed_hash<>reference_json->>'content_hash'
    then raise exception using errcode='P0001',message='E1_ANALYSIS_PUBLICATION_REPORT_INVALID'; end if;
    insert into app_data_agent.artifacts(
      app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,
      document_json,worker_fence,is_active,parent_revision,parent_content_hash,created_at)
    values((scope_json->>'app_id')::uuid,(scope_json->>'tenant_id')::uuid,
      scope_json->>'environment',(command_json->>'run_id')::uuid,
      (reference_json->>'artifact_id')::uuid,'AnalysisReport',1,reference_json->>'content_hash',
      report_json,(command_json->>'worker_fence')::bigint,true,null,null,db_now);
    all_references:=all_references||pg_catalog.jsonb_build_array(reference_json);
    artifact_bindings:=artifact_bindings||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('role','REPORT','reference',reference_json));

    receipt_json:=pg_catalog.jsonb_build_object(
      'schema_version','e1-analysis-publication-receipt@1.0.0','created',true,
      'publication_hash',command_json->>'publication_hash',
      'public_event_id',command_json->>'public_event_id','references',all_references);
    insert into app_data_agent.e1_analysis_publications(
      app_id,tenant_id,environment,run_id,publication_hash,principal_id,attempt_id,worker_fence,
      idempotency_key,analysis_program_ref,public_event_id,command_json,receipt_json,committed_at)
    values((scope_json->>'app_id')::uuid,(scope_json->>'tenant_id')::uuid,
      scope_json->>'environment',(command_json->>'run_id')::uuid,command_json->>'publication_hash',
      (command_json->>'principal_id')::uuid,(command_json->>'attempt_id')::uuid,
      (command_json->>'worker_fence')::bigint,command_json->>'idempotency_key',
      command_json->'analysis_program_ref',(command_json->>'public_event_id')::uuid,
      command_json,receipt_json,db_now);
    for binding_item in select value from pg_catalog.jsonb_array_elements(artifact_bindings) loop
      ordinal_value:=ordinal_value+1;
      insert into app_data_agent.e1_analysis_publication_artifacts(
        app_id,tenant_id,environment,run_id,publication_hash,ordinal,role,reference_json)
      values((scope_json->>'app_id')::uuid,(scope_json->>'tenant_id')::uuid,
        scope_json->>'environment',(command_json->>'run_id')::uuid,
        command_json->>'publication_hash',ordinal_value,binding_item->>'role',binding_item->'reference');
    end loop;
    insert into app_data_agent.e1_analysis_publication_current(
      app_id,tenant_id,environment,run_id,publication_hash,public_event_id,committed_at)
    values((scope_json->>'app_id')::uuid,(scope_json->>'tenant_id')::uuid,
      scope_json->>'environment',(command_json->>'run_id')::uuid,
      command_json->>'publication_hash',(command_json->>'public_event_id')::uuid,db_now);
    insert into app_data_agent.e1_analysis_publication_outbox(
      app_id,tenant_id,environment,run_id,public_event_id,publication_hash,payload_json)
    values((scope_json->>'app_id')::uuid,(scope_json->>'tenant_id')::uuid,
      scope_json->>'environment',(command_json->>'run_id')::uuid,
      (command_json->>'public_event_id')::uuid,command_json->>'publication_hash',
      pg_catalog.jsonb_build_object('event_name','e1_analysis_publication_committed',
        'publication_hash',command_json->>'publication_hash','references',all_references));
  exception when sqlstate 'P0001' then
    return pg_catalog.jsonb_build_object('ok',false,'error_code',sqlerrm);
  end;
  return pg_catalog.jsonb_build_object('ok',true,'receipt',receipt_json);
exception when invalid_text_representation or numeric_value_out_of_range then
  return pg_catalog.jsonb_build_object('ok',false,'error_code','E1_ANALYSIS_PUBLICATION_CONTRACT_INVALID');
end
$function$;
