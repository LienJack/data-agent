create function app_data_agent.assert_resolved_context_integrity()
returns void language plpgsql stable set search_path='' as $function$
begin
  if exists (
    select 1 from app_data_agent.resolved_context_receipts receipt
    where receipt.request_hash<>receipt.receipt_json->>'request_hash'
      or receipt.package_key_hash<>app_data_agent.resolved_context_package_key_hash(receipt.package_json)
      or receipt.package_id<>app_data_agent.resolved_context_uuid_v8_from_hash(receipt.package_key_hash)
      or receipt.package_hash<>app_data_agent.u2_canonical_sha256(receipt.package_json-'package_hash')
      or receipt.receipt_hash<>app_data_agent.u2_canonical_sha256(receipt.receipt_json-'receipt_hash')
      or receipt.package_id::text<>receipt.package_json->>'package_id'
      or receipt.authority_snapshot_hash<>receipt.package_json->>'authority_snapshot_hash'
  ) then raise exception using errcode='23514',message='RESOLVED_CONTEXT_INTEGRITY_FAILED'; end if;
end
$function$;
