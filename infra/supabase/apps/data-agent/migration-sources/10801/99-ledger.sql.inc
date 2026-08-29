select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010801_app_data_agent_falcon24_e9_current_profile_authority',
  '__FALCON24_E9_CURRENT_PROFILE_AUTHORITY_MIGRATION_CHECKSUM__');

commit;
