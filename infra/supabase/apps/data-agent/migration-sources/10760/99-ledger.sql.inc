select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010760_app_data_agent_analysis_authority_row_lock_policy',
  '__ANALYSIS_AUTHORITY_ROW_LOCK_POLICY_MIGRATION_CHECKSUM__');
commit;
