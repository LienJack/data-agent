select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010723_app_data_agent_semantic_context_commit_diagnostics',
  '__SEMANTIC_CONTEXT_COMMIT_DIAGNOSTICS_MIGRATION_CHECKSUM__');
commit;
