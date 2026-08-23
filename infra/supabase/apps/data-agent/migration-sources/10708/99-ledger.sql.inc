select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010708_app_data_agent_semantic_context_cutover',
  '__SEMANTIC_CONTEXT_CUTOVER_MIGRATION_CHECKSUM__');
commit;
