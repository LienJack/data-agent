select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010705_app_data_agent_resolved_context_lexicon',
  '__RESOLVED_CONTEXT_LEXICON_MIGRATION_CHECKSUM__'
);

commit;
