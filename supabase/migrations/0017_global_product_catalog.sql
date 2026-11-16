-- Horekia: catálogo reutilizable de productos del tenant.
-- Los productos globales viven en horekia_items con job_type_id NULL.
-- Los conceptos facturables específicos de un servicio mantienen su job_type_id.
create index if not exists horekia_global_products_tenant_idx
  on public.horekia_items(tenant_id, name)
  where job_type_id is null and status = 'active';

comment on table public.horekia_items is
  'Catálogo de conceptos. job_type_id NULL identifica productos reutilizables del tenant; un job_type_id identifica conceptos propios de un servicio.';

-- Migra los productos que ya se habían cargado dentro de un servicio en la POC
-- sin cambiar su SKU ni romper las asociaciones de los patrones.
update public.horekia_items
set job_type_id = null, updated_at = now()
where job_type_id is not null
  and metadata ? 'catalog_product';
