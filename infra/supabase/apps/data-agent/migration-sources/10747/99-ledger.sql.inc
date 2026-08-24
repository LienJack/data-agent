select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010747_app_data_agent_analysis_authority_commit_closure',
  '__ANALYSIS_AUTHORITY_COMMIT_CLOSURE_MIGRATION_CHECKSUM__');
commit;
