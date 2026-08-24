select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010756_app_data_agent_analysis_result_stage_ordinality_repair',
  '__ANALYSIS_RESULT_STAGE_ORDINALITY_REPAIR_MIGRATION_CHECKSUM__');
commit;
