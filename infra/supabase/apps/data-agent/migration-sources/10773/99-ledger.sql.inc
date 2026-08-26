select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010773_app_data_agent_falcon24_ui_trace_gate',
  '__FALCON24_UI_TRACE_GATE_MIGRATION_CHECKSUM__');
commit;
