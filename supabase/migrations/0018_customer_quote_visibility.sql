-- El cliente puede retirar un presupuesto de su cuenta sin borrar el historial operativo del tenant.
alter table public.horekia_quotes
  add column if not exists customer_deleted_at timestamptz;

create index if not exists horekia_quotes_customer_visibility_idx
  on public.horekia_quotes(tenant_id, customer_deleted_at, created_at desc);
