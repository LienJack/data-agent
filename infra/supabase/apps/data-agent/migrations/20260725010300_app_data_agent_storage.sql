begin;

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010300_app_data_agent_storage',
  'sha256:899facc545375682918e08b92a569b309b4b96fc2e162b8fde11954f322489ef'
);

do $$
begin
  if pg_catalog.to_regclass('storage.objects') is null
    or pg_catalog.to_regclass('storage.buckets') is null
    or pg_catalog.to_regprocedure('storage.foldername(text)') is null
    or pg_catalog.to_regprocedure('storage.filename(text)') is null
    or pg_catalog.to_regprocedure('auth.uid()') is null
  then
    raise exception using
      errcode = 'P0001',
      message = 'DA_SUPABASE_STORAGE_PREREQUISITE_MISSING';
  end if;
end
$$;

insert into storage.buckets (id, name, public)
values ('data-agent-artifacts', 'data-agent-artifacts', false)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
    from storage.buckets as bucket
    where bucket.id = 'data-agent-artifacts'
      and bucket.name = 'data-agent-artifacts'
      and not bucket.public
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'DA_STORAGE_BUCKET_CONFLICT';
  end if;
end
$$;

create policy data_agent_artifacts_select_allow
on storage.objects
for select
to authenticated, data_agent_backend
using (
  bucket_id = 'data-agent-artifacts'
  and platform.storage_object_allowed(bucket_id, name, false)
);

create policy data_agent_artifacts_select_guard
on storage.objects
as restrictive
for select
to public
using (
  bucket_id <> 'data-agent-artifacts'
  or platform.storage_object_allowed(bucket_id, name, false)
);

create policy data_agent_artifacts_insert_allow
on storage.objects
for insert
to authenticated, data_agent_backend
with check (
  bucket_id = 'data-agent-artifacts'
  and platform.storage_object_allowed(bucket_id, name, true)
);

create policy data_agent_artifacts_insert_guard
on storage.objects
as restrictive
for insert
to public
with check (
  bucket_id <> 'data-agent-artifacts'
  or platform.storage_object_allowed(bucket_id, name, true)
);

create policy data_agent_artifacts_update_allow
on storage.objects
for update
to authenticated, data_agent_backend
using (
  bucket_id = 'data-agent-artifacts'
  and platform.storage_object_allowed(bucket_id, name, true)
)
with check (
  bucket_id = 'data-agent-artifacts'
  and platform.storage_object_allowed(bucket_id, name, true)
);

create policy data_agent_artifacts_update_guard
on storage.objects
as restrictive
for update
to public
using (
  bucket_id <> 'data-agent-artifacts'
  or platform.storage_object_allowed(bucket_id, name, true)
)
with check (
  bucket_id <> 'data-agent-artifacts'
  or platform.storage_object_allowed(bucket_id, name, true)
);

create policy data_agent_artifacts_delete_allow
on storage.objects
for delete
to authenticated, data_agent_backend
using (
  bucket_id = 'data-agent-artifacts'
  and platform.storage_object_allowed(bucket_id, name, true)
);

create policy data_agent_artifacts_delete_guard
on storage.objects
as restrictive
for delete
to public
using (
  bucket_id <> 'data-agent-artifacts'
  or platform.storage_object_allowed(bucket_id, name, true)
);

revoke all privileges on function platform.storage_object_allowed(
  text,
  text,
  boolean
) from public, anon, authenticated, service_role, data_agent_backend;
grant execute on function platform.storage_object_allowed(
  text,
  text,
  boolean
) to anon, authenticated, data_agent_backend;
grant usage on schema storage to data_agent_backend;
grant select, insert, update, delete on table storage.objects to data_agent_backend;

commit;
