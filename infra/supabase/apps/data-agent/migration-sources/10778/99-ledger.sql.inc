select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010778_app_data_agent_e1_legacy_runtime_retirement',
  '__E1_LEGACY_RUNTIME_RETIREMENT_MIGRATION_CHECKSUM__');
commit;
