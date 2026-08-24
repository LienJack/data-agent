select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010733_app_data_agent_semantic_change_set_projection',
  '__SEMANTIC_CHANGE_SET_PROJECTION_MIGRATION_CHECKSUM__');
commit;
