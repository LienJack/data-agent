create function app_data_agent.reject_knowledge_immutable_mutation()
returns trigger language plpgsql set search_path=''
as $function$
begin
  raise exception using errcode='55000',message='KNOWLEDGE_AUTHORITY_IMMUTABLE';
end
$function$;

create trigger knowledge_embedding_profile_revisions_immutable
before update or delete on app_data_agent.knowledge_embedding_profile_revisions
for each row execute function app_data_agent.reject_knowledge_immutable_mutation();
create trigger knowledge_base_revisions_immutable
before update or delete on app_data_agent.knowledge_base_revisions
for each row execute function app_data_agent.reject_knowledge_immutable_mutation();
create trigger knowledge_projection_receipts_immutable
before update or delete on app_data_agent.knowledge_projection_receipts
for each row execute function app_data_agent.reject_knowledge_immutable_mutation();
create trigger knowledge_chunks_immutable
before update or delete on app_data_agent.knowledge_chunks
for each row execute function app_data_agent.reject_knowledge_immutable_mutation();
create trigger knowledge_retrieval_receipts_immutable
before update or delete on app_data_agent.knowledge_retrieval_receipts
for each row execute function app_data_agent.reject_knowledge_immutable_mutation();
create trigger knowledge_idempotency_immutable
before update or delete on app_data_agent.knowledge_idempotency
for each row execute function app_data_agent.reject_knowledge_immutable_mutation();
