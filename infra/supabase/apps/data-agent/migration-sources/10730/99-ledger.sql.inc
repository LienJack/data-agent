select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010730_app_data_agent_semantic_receipt_hash_precedence',
  '__SEMANTIC_RECEIPT_HASH_PRECEDENCE_MIGRATION_CHECKSUM__');
commit;
