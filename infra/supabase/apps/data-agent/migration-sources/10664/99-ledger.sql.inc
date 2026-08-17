select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010664_app_data_agent_resolved_context_text2sql',
  '__U13_TEXT2SQL_MIGRATION_CHECKSUM__'
);

commit;
