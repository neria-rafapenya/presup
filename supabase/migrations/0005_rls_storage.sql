-- Horekia Fase 1: aislamiento técnico y adjuntos privados.
-- Las operaciones de inicialización con service_role omiten RLS; las operaciones
-- ordinarias usan la identidad JWT del usuario mediante auth.uid().
do $$
declare
  table_name text;
  tenant_tables text[] := array[
    'tenant_users', 'tenant_settings', 'job_types', 'intake_schemas', 'items',
    'item_variables', 'price_rules', 'computed_measures', 'vocabulary', 'policies',
    'faqs', 'customers', 'consents', 'requests', 'messages', 'attachments',
    'quotes', 'quote_lines', 'quote_events', 'corrections', 'embeddings',
    'imports', 'usage_limits', 'usage_log'
  ];
begin
  foreach table_name in array tenant_tables loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy %I on public.%I for select using (app.is_tenant_member(tenant_id))',
      table_name || '_tenant_select', table_name
    );
    execute format(
      'create policy %I on public.%I for insert with check (app.has_tenant_role(tenant_id, ARRAY[''owner'', ''editor'']::public.tenant_user_role[]))',
      table_name || '_tenant_insert', table_name
    );
    execute format(
      'create policy %I on public.%I for update using (app.has_tenant_role(tenant_id, ARRAY[''owner'', ''editor'']::public.tenant_user_role[])) with check (app.has_tenant_role(tenant_id, ARRAY[''owner'', ''editor'']::public.tenant_user_role[]))',
      table_name || '_tenant_update', table_name
    );
    execute format(
      'create policy %I on public.%I for delete using (app.has_tenant_role(tenant_id, ARRAY[''owner'']::public.tenant_user_role[]))',
      table_name || '_tenant_delete', table_name
    );
  end loop;
end;
$$;

-- Los revisores pueden cambiar el estado de trabajo operativo; la API debe limitar
-- las columnas editables y registrar el evento correspondiente.
create policy requests_reviewer_update on public.requests
  for update
  using (app.has_tenant_role(tenant_id, ARRAY['owner', 'editor', 'reviewer']::public.tenant_user_role[]))
  with check (app.has_tenant_role(tenant_id, ARRAY['owner', 'editor', 'reviewer']::public.tenant_user_role[]));

create policy quotes_reviewer_update on public.quotes
  for update
  using (app.has_tenant_role(tenant_id, ARRAY['owner', 'editor', 'reviewer']::public.tenant_user_role[]))
  with check (app.has_tenant_role(tenant_id, ARRAY['owner', 'editor', 'reviewer']::public.tenant_user_role[]));

create policy corrections_reviewer_insert on public.corrections
  for insert
  with check (app.has_tenant_role(tenant_id, ARRAY['owner', 'editor', 'reviewer']::public.tenant_user_role[]));

alter table public.tenants enable row level security;
create policy tenants_member_select on public.tenants
  for select using (app.is_tenant_member(id));

alter table public.sector_packs enable row level security;
create policy sector_packs_authenticated_select on public.sector_packs
  for select to authenticated using (true);

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do update set public = false;

create policy attachments_private_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and name ~ '^[0-9a-f-]{36}/'
    and app.is_tenant_member(split_part(name, '/', 1)::uuid)
  );

create policy attachments_private_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and name ~ '^[0-9a-f-]{36}/'
    and app.has_tenant_role(split_part(name, '/', 1)::uuid, ARRAY['owner', 'editor']::public.tenant_user_role[])
  );

create policy attachments_private_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'attachments'
    and name ~ '^[0-9a-f-]{36}/'
    and app.has_tenant_role(split_part(name, '/', 1)::uuid, ARRAY['owner', 'editor']::public.tenant_user_role[])
  )
  with check (
    bucket_id = 'attachments'
    and name ~ '^[0-9a-f-]{36}/'
    and app.has_tenant_role(split_part(name, '/', 1)::uuid, ARRAY['owner', 'editor']::public.tenant_user_role[])
  );

create policy attachments_private_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and name ~ '^[0-9a-f-]{36}/'
    and app.has_tenant_role(split_part(name, '/', 1)::uuid, ARRAY['owner']::public.tenant_user_role[])
  );
