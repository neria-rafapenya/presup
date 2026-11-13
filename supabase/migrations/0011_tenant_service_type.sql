-- Horekia POC: tipo de servicio activo del tenant.
-- El frontend público solo ofrece servicios de este tipo.
alter table public.horekia_tenant_profiles
  add column if not exists service_type_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'horekia_tenant_profiles_service_type_fk') then
    alter table public.horekia_tenant_profiles
      add constraint horekia_tenant_profiles_service_type_fk
      foreign key (tenant_id, service_type_id)
      references public.horekia_service_types(tenant_id, id)
      on delete set null;
  end if;
end;
$$;

update public.horekia_tenant_profiles p
set service_type_id = st.id,
    updated_at = now()
from public.horekia_service_types st
where p.tenant_id = st.tenant_id
  and p.tenant_id = '00000000-0000-0000-0000-000000000001'
  and st.slug = 'imprenta';
