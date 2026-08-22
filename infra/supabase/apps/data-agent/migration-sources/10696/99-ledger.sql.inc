select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010696_app_data_agent_model_driven_subagent_harness',
  '__MODEL_DRIVEN_SUBAGENT_HARNESS_MIGRATION_CHECKSUM__');

commit;
