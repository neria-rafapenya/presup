-- Radio de acción configurable por tenant para validar la cobertura geográfica.
alter table public.horekia_tenant_profiles
  add column if not exists service_radius_km numeric(8,1) not null default 100.0
  check (service_radius_km > 0 and service_radius_km <= 1000);
