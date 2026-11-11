-- Horekia Fase 1: aislamiento técnico y adjuntos privados.
-- Las operaciones de inicialización con service_role omiten RLS; las operaciones
-- ordinarias usan la identidad JWT del usuario mediante auth.uid().
do $$
declare
  table_name text;
  tenant_tables text[] := array[
    'horekia_tenant_users', 'horekia_tenant_settings', 'horekia_job_types',
    'horekia_intake_schemas', 'horekia_items', 'horekia_item_variables',
    'horekia_price_rules', 'horekia_computed_measures', 'horekia_vocabulary',
    'horekia_policies', 'horekia_faqs', 'horekia_customers', 'horekia_consents',
    'horekia_requests', 'horekia_messages', 'horekia_attachments',
    'horekia_quotes', 'horekia_quote_lines', 'horekia_quote_events',
    'horekia_corrections', 'horekia_embeddings', 'horekia_imports',
    'horekia_usage_limits', 'horekia_usage_log'
  ];
begin
  foreach table_name in array tenant_tables loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy %I on public.%I for select using (horekia_app.is_tenant_member(tenant_id))',
      table_name || '_tenant_select', table_name
    );
    execute format(
      'create policy %I on public.%I for insert with check (horekia_app.has_tenant_role(tenant_id, ARRAY[''owner'', ''editor'']::public.horekia_tenant_user_role[]))',
      table_name || '_tenant_insert', table_name
    );
    execute format(
      'create policy %I on public.%I for update using (horekia_app.has_tenant_role(tenant_id, ARRAY[''owner'', ''editor'']::public.horekia_tenant_user_role[])) with check (horekia_app.has_tenant_role(tenant_id, ARRAY[''owner'', ''editor'']::public.horekia_tenant_user_role[]))',
      table_name || '_tenant_update', table_name
    );
    execute format(
      'create policy %I on public.%I for delete using (horekia_app.has_tenant_role(tenant_id, ARRAY[''owner'']::public.horekia_tenant_user_role[]))',
      table_name || '_tenant_delete', table_name
    );
  end loop;
end;
$$;

-- Los revisores pueden cambiar el estado de trabajo operativo; la API debe limitar
-- las columnas editables y registrar el evento correspondiente.
create policy horekia_requests_reviewer_update on public.horekia_requests
  for update
  using (horekia_app.has_tenant_role(tenant_id, ARRAY['owner', 'editor', 'reviewer']::public.horekia_tenant_user_role[]))
  with check (horekia_app.has_tenant_role(tenant_id, ARRAY['owner', 'editor', 'reviewer']::public.horekia_tenant_user_role[]));

create policy horekia_quotes_reviewer_update on public.horekia_quotes
  for update
  using (horekia_app.has_tenant_role(tenant_id, ARRAY['owner', 'editor', 'reviewer']::public.horekia_tenant_user_role[]))
  with check (horekia_app.has_tenant_role(tenant_id, ARRAY['owner', 'editor', 'reviewer']::public.horekia_tenant_user_role[]));

create policy horekia_corrections_reviewer_insert on public.horekia_corrections
  for insert
  with check (horekia_app.has_tenant_role(tenant_id, ARRAY['owner', 'editor', 'reviewer']::public.horekia_tenant_user_role[]));

alter table public.horekia_tenants enable row level security;
create policy horekia_tenants_member_select on public.horekia_tenants
  for select using (horekia_app.is_tenant_member(id));

alter table public.horekia_sector_packs enable row level security;
create policy horekia_sector_packs_authenticated_select on public.horekia_sector_packs
  for select to authenticated using (true);

-- Storage de Supabase no se modifica en esta instalación compartida. El acceso
-- privado a adjuntos se implementará en una migración aislada tras autorización.
