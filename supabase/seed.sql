-- Datos ficticios mínimos para desarrollo local. No son tarifas reales.
-- Ejecutar con el rol de inicialización/service_role; las tablas de negocio tienen RLS.
insert into public.horekia_tenants (id, name, slug)
values
  ('00000000-0000-0000-0000-000000000001', 'Empresa Demo Uno', 'empresa-demo-uno'),
  ('00000000-0000-0000-0000-000000000002', 'Empresa Demo Dos', 'empresa-demo-dos')
on conflict (id) do nothing;

insert into public.horekia_tenant_settings (tenant_id)
values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002')
on conflict (tenant_id) do nothing;

insert into public.horekia_job_types (tenant_id, slug, name, description)
values
  ('00000000-0000-0000-0000-000000000001', 'bolsas', 'Bolsas personalizadas', 'Servicio ficticio para pruebas'),
  ('00000000-0000-0000-0000-000000000002', 'reformas', 'Reformas', 'Servicio ficticio para pruebas')
on conflict (tenant_id, slug) do nothing;

insert into public.horekia_items (tenant_id, name, unit, base_price)
values
  ('00000000-0000-0000-0000-000000000001', 'Bolsa de algodón demo', 'unit', 4.50),
  ('00000000-0000-0000-0000-000000000002', 'Visita técnica demo', 'hour', 45.00);
