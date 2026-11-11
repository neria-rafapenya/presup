-- Horekia Fase 5: ficha comercial y operativa del tenant.
-- El PDF se guarda en una tabla propia durante la POC; Storage queda aislado
-- para una integración posterior.
create table if not exists public.horekia_tenant_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.horekia_tenants(id) on delete cascade,
  kind text not null check (kind in ('quote_template', 'proforma_template', 'other')),
  filename text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  content bytea not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table if not exists public.horekia_tenant_profiles (
  tenant_id uuid primary key references public.horekia_tenants(id) on delete cascade,
  legal_name text,
  display_name text,
  tax_id text,
  contact_name text,
  contact_role text,
  contact_email text,
  contact_phone text,
  billing_email text,
  quotes_email text,
  address_line1 text,
  address_line2 text,
  postal_code text,
  city text,
  region text,
  country text not null default 'España',
  quote_document_type text not null default 'quote' check (quote_document_type in ('quote', 'proforma')),
  quote_template_document_id uuid,
  disclaimers text,
  warranty_terms text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists horekia_tenant_documents_tenant_kind_idx
  on public.horekia_tenant_documents(tenant_id, kind, created_at desc);

insert into public.horekia_tenant_profiles (tenant_id, legal_name, display_name)
select id, name, name from public.horekia_tenants
on conflict (tenant_id) do nothing;

alter table public.horekia_tenant_documents enable row level security;
alter table public.horekia_tenant_profiles enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'horekia_tenant_documents_tenant_select') then
    create policy horekia_tenant_documents_tenant_select on public.horekia_tenant_documents
      for select using (horekia_app.is_tenant_member(tenant_id));
  end if;
  if not exists (select 1 from pg_policies where policyname = 'horekia_tenant_documents_tenant_insert') then
    create policy horekia_tenant_documents_tenant_insert on public.horekia_tenant_documents
      for insert with check (horekia_app.has_tenant_role(tenant_id, ARRAY['owner', 'editor']::public.horekia_tenant_user_role[]));
  end if;
  if not exists (select 1 from pg_policies where policyname = 'horekia_tenant_documents_tenant_delete') then
    create policy horekia_tenant_documents_tenant_delete on public.horekia_tenant_documents
      for delete using (horekia_app.has_tenant_role(tenant_id, ARRAY['owner']::public.horekia_tenant_user_role[]));
  end if;
  if not exists (select 1 from pg_policies where policyname = 'horekia_tenant_profiles_tenant_select') then
    create policy horekia_tenant_profiles_tenant_select on public.horekia_tenant_profiles
      for select using (horekia_app.is_tenant_member(tenant_id));
  end if;
  if not exists (select 1 from pg_policies where policyname = 'horekia_tenant_profiles_tenant_insert') then
    create policy horekia_tenant_profiles_tenant_insert on public.horekia_tenant_profiles
      for insert with check (horekia_app.has_tenant_role(tenant_id, ARRAY['owner', 'editor']::public.horekia_tenant_user_role[]));
  end if;
  if not exists (select 1 from pg_policies where policyname = 'horekia_tenant_profiles_tenant_update') then
    create policy horekia_tenant_profiles_tenant_update on public.horekia_tenant_profiles
      for update using (horekia_app.has_tenant_role(tenant_id, ARRAY['owner', 'editor']::public.horekia_tenant_user_role[]))
      with check (horekia_app.has_tenant_role(tenant_id, ARRAY['owner', 'editor']::public.horekia_tenant_user_role[]));
  end if;
end;
$$;
