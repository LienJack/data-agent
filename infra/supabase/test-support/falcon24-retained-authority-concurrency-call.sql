begin;

select pg_catalog.set_config('data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
select pg_catalog.set_config('data_agent.tenant_id','00000000-0000-4000-8000-00000000e124',true);
select pg_catalog.set_config('data_agent.environment','local',true);
select pg_catalog.set_config('data_agent.deployment_id','00000000-0000-4000-8000-000000000001',true);
select pg_catalog.set_config('data_agent.principal_id','00000000-0000-4000-8000-00000000e125',true);
select pg_catalog.set_config('data_agent.role','owner',true);
select pg_catalog.set_config('app.semantic_domain','falcon24',true);

select app_data_agent.activate_falcon24_authority(command)
from falcon24_w2_test.retained_activation_command
where authority_epoch='E6';

\if :{?hold_after_activation}
select pg_catalog.pg_sleep(2);
\endif

commit;
