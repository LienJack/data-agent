select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010698_app_data_agent_subagent_harness_runtime_repair',
  '__SUBAGENT_HARNESS_RUNTIME_REPAIR_MIGRATION_CHECKSUM__'
);
commit;
