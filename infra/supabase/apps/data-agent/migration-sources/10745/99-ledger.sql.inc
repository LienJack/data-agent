select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010745_app_data_agent_analysis_operator_request_authority',
  '__ANALYSIS_OPERATOR_REQUEST_AUTHORITY_MIGRATION_CHECKSUM__');
commit;
