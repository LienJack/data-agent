select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010677_app_data_agent_knowledge_document_authority_repair',
  '__KNOWLEDGE_DOCUMENT_AUTHORITY_REPAIR_MIGRATION_CHECKSUM__'
);
commit;
