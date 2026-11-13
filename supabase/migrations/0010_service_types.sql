-- Horekia POC: tipos de servicio propios de cada tenant.
-- La categoría superior es tenant-scoped para no compartir configuraciones
-- entre instalaciones en la base PostgreSQL compartida.
create table if not exists public.horekia_service_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.horekia_tenants(id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  status public.horekia_record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, slug)
);

alter table public.horekia_job_types
  add column if not exists service_type_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'horekia_job_types_service_type_fk') then
    alter table public.horekia_job_types
      add constraint horekia_job_types_service_type_fk
      foreign key (tenant_id, service_type_id)
      references public.horekia_service_types(tenant_id, id)
      on delete set null;
  end if;
end;
$$;

create index if not exists horekia_service_types_tenant_name_idx
  on public.horekia_service_types(tenant_id, name);

alter table public.horekia_service_types enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'horekia_service_types_tenant_select') then
    create policy horekia_service_types_tenant_select on public.horekia_service_types
      for select using (horekia_app.is_tenant_member(tenant_id));
  end if;
  if not exists (select 1 from pg_policies where policyname = 'horekia_service_types_tenant_insert') then
    create policy horekia_service_types_tenant_insert on public.horekia_service_types
      for insert with check (horekia_app.has_tenant_role(tenant_id, ARRAY['owner', 'editor']::public.horekia_tenant_user_role[]));
  end if;
  if not exists (select 1 from pg_policies where policyname = 'horekia_service_types_tenant_update') then
    create policy horekia_service_types_tenant_update on public.horekia_service_types
      for update using (horekia_app.has_tenant_role(tenant_id, ARRAY['owner', 'editor']::public.horekia_tenant_user_role[]))
      with check (horekia_app.has_tenant_role(tenant_id, ARRAY['owner', 'editor']::public.horekia_tenant_user_role[]));
  end if;
end;
$$;

insert into public.horekia_service_types (tenant_id, slug, name, description)
values
  ('00000000-0000-0000-0000-000000000001', 'imprenta', 'Imprenta', 'Servicios de impresión, rotulación y productos gráficos.'),
  ('00000000-0000-0000-0000-000000000001', 'taller-de-coches', 'Taller de coches', 'Servicios de mecánica, mantenimiento y reparación de vehículos.'),
  ('00000000-0000-0000-0000-000000000001', 'empresa-de-reformas', 'Empresa de reformas', 'Servicios de reformas, obras y mantenimiento de espacios.')
on conflict (tenant_id, slug) do update
set name = excluded.name,
    description = excluded.description,
    updated_at = now();

update public.horekia_job_types j
set service_type_id = st.id,
    updated_at = now()
from public.horekia_service_types st
where j.tenant_id = st.tenant_id
  and j.tenant_id = '00000000-0000-0000-0000-000000000001'
  and st.slug = case when j.slug = 'reforma-de-bano' then 'empresa-de-reformas' else 'imprenta' end;
