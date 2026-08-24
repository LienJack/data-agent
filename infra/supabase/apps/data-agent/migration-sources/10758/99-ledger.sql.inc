select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010758_app_data_agent_analysis_stage_observation_variable_repair',
  '__ANALYSIS_STAGE_OBSERVATION_VARIABLE_REPAIR_MIGRATION_CHECKSUM__');
commit;
