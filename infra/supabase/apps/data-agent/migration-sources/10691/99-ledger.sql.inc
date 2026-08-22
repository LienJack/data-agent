select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010691_app_data_agent_semantic_text2sql_promotion',
  '__SEMANTIC_TEXT2SQL_PROMOTION_MIGRATION_CHECKSUM__'
);
commit;
