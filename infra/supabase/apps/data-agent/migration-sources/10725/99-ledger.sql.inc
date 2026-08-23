select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010725_app_data_agent_semantic_context_safe_exception_projection',
  '__SEMANTIC_CONTEXT_SAFE_EXCEPTION_MIGRATION_CHECKSUM__');
commit;
