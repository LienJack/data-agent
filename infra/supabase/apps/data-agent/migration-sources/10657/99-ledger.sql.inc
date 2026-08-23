select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010657_app_data_agent_artifact_export_authority',
  '__ARTIFACT_EXPORT_MIGRATION_CHECKSUM__'
);

commit;
