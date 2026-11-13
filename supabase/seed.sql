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

insert into public.horekia_service_types (tenant_id, slug, name, description)
values
  ('00000000-0000-0000-0000-000000000001', 'imprenta', 'Imprenta', 'Servicios de impresión, rotulación y productos gráficos.'),
  ('00000000-0000-0000-0000-000000000001', 'taller-de-coches', 'Taller de coches', 'Servicios de mecánica, mantenimiento y reparación de vehículos.'),
  ('00000000-0000-0000-0000-000000000001', 'empresa-de-reformas', 'Empresa de reformas', 'Servicios de reformas, obras y mantenimiento de espacios.')
on conflict (tenant_id, slug) do nothing;

insert into public.horekia_job_types (tenant_id, slug, name, description, service_type_id)
values
  ('00000000-0000-0000-0000-000000000001', 'bolsas', 'Bolsas personalizadas', 'Servicio ficticio para pruebas', (select id from public.horekia_service_types where tenant_id = '00000000-0000-0000-0000-000000000001' and slug = 'imprenta')),
  ('00000000-0000-0000-0000-000000000002', 'reformas', 'Reformas', 'Servicio ficticio para pruebas', null)
on conflict (tenant_id, slug) do nothing;

insert into public.horekia_items (tenant_id, name, unit, base_price)
values
  ('00000000-0000-0000-0000-000000000001', 'Bolsa de algodón demo', 'unit', 4.50),
  ('00000000-0000-0000-0000-000000000002', 'Visita técnica demo', 'hour', 45.00);
