select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010710_app_data_agent_analysis_python_source_replay',
  '__ANALYSIS_PYTHON_SOURCE_REPLAY_MIGRATION_CHECKSUM__');
commit;
