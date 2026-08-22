select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010680_app_data_agent_knowledge_documents','__KNOWLEDGE_DOCUMENT_MIGRATION_CHECKSUM__');
commit;
