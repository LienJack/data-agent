select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010732_app_data_agent_qa_directory_semantic_helper_cutover',
  '__QA_DIRECTORY_SEMANTIC_HELPER_MIGRATION_CHECKSUM__');
commit;
