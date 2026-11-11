-- Horekia Fase 5: conocimiento estructurado del negocio del tenant.
-- Las filas pueden proceder de formularios, CSV o documentos y sirven como
-- contexto para Gemini; los importes deterministas siguen viviendo en items y
-- price_rules.
create table if not exists public.horekia_knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.horekia_tenants(id) on delete cascade,
  kind text not null check (kind in ('product', 'category', 'sales_pattern', 'policy', 'faq', 'document', 'other')),
  title text not null,
  content text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  source_type text not null default 'manual' check (source_type in ('manual', 'csv', 'document', 'ai')),
  source_name text,
  source_import_id uuid,
  status public.horekia_record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, source_import_id)
    references public.horekia_imports(tenant_id, id) on delete set null
);

create index if not exists horekia_knowledge_entries_tenant_kind_idx
  on public.horekia_knowledge_entries(tenant_id, kind, status);

alter table public.horekia_knowledge_entries enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'horekia_knowledge_entries_tenant_select') then
    create policy horekia_knowledge_entries_tenant_select on public.horekia_knowledge_entries
      for select using (horekia_app.is_tenant_member(tenant_id));
  end if;
  if not exists (select 1 from pg_policies where policyname = 'horekia_knowledge_entries_tenant_insert') then
    create policy horekia_knowledge_entries_tenant_insert on public.horekia_knowledge_entries
      for insert with check (horekia_app.has_tenant_role(tenant_id, ARRAY['owner', 'editor']::public.horekia_tenant_user_role[]));
  end if;
  if not exists (select 1 from pg_policies where policyname = 'horekia_knowledge_entries_tenant_update') then
    create policy horekia_knowledge_entries_tenant_update on public.horekia_knowledge_entries
      for update using (horekia_app.has_tenant_role(tenant_id, ARRAY['owner', 'editor']::public.horekia_tenant_user_role[]))
      with check (horekia_app.has_tenant_role(tenant_id, ARRAY['owner', 'editor']::public.horekia_tenant_user_role[]));
  end if;
  if not exists (select 1 from pg_policies where policyname = 'horekia_knowledge_entries_tenant_delete') then
    create policy horekia_knowledge_entries_tenant_delete on public.horekia_knowledge_entries
      for delete using (horekia_app.has_tenant_role(tenant_id, ARRAY['owner']::public.horekia_tenant_user_role[]));
  end if;
end;
$$;
