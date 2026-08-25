select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010768_app_data_agent_governed_analysis_profile_v2',
  '__GOVERNED_ANALYSIS_PROFILE_V2_MIGRATION_CHECKSUM__');
commit;
