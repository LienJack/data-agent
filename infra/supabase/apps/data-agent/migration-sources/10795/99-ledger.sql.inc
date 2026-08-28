select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010795_app_data_agent_falcon24_authority_staging_hold',
  '__FALCON24_AUTHORITY_STAGING_HOLD_MIGRATION_CHECKSUM__');

commit;
