select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010673_app_data_agent_qa_conversation_directory','__QA_DIRECTORY_MIGRATION_CHECKSUM__');
commit;
