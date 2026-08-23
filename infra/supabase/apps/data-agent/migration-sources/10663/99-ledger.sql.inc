select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010663_app_data_agent_resolved_context',
  '__RESOLVED_CONTEXT_MIGRATION_CHECKSUM__'
);

commit;
