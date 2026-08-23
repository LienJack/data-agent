select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010711_app_data_agent_analysis_input_materialization',
  '__ANALYSIS_INPUT_MATERIALIZATION_MIGRATION_CHECKSUM__');
commit;
