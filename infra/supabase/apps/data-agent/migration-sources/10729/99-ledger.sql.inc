select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010729_app_data_agent_semantic_canonicalizer_exception_projection',
  '__SEMANTIC_CANONICALIZER_EXCEPTION_MIGRATION_CHECKSUM__');
commit;
