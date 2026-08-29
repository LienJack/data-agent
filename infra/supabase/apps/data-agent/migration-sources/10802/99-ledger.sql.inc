select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010802_app_data_agent_falcon24_e10_versioned_profile_authority',
  '__FALCON24_E10_VERSIONED_PROFILE_AUTHORITY_MIGRATION_CHECKSUM__');

commit;
