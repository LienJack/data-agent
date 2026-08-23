select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010637_app_data_agent_adb_ecommerce_workspace',
  '__ADB_ECOMMERCE_WORKSPACE_MIGRATION_CHECKSUM__'
);

commit;
