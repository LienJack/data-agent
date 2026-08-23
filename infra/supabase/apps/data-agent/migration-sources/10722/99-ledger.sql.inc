select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010722_app_data_agent_semantic_context_jsonb_operator_repair',
  '__SEMANTIC_CONTEXT_JSONB_OPERATOR_REPAIR_MIGRATION_CHECKSUM__');
commit;
