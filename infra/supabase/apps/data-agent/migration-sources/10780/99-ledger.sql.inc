select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010780_app_data_agent_falcon24_e1_runtime_profile',
  '__FALCON24_E1_RUNTIME_PROFILE_MIGRATION_CHECKSUM__');
commit;
