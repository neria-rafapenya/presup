-- Horekia POC: cuentas ligeras para clientes solicitantes.
-- Se mantienen desacopladas de Supabase Auth; la autenticación de backoffice
-- sigue siendo una fase posterior.
alter table public.horekia_customers
  add column if not exists account_password_hash text,
  add column if not exists account_created_at timestamptz,
  add column if not exists last_login_at timestamptz;

create table if not exists public.horekia_customer_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.horekia_tenants(id) on delete cascade,
  customer_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.horekia_customers(tenant_id, id) on delete cascade
);

create index if not exists horekia_customer_sessions_customer_idx
  on public.horekia_customer_sessions(tenant_id, customer_id, expires_at desc);

alter table public.horekia_customer_sessions enable row level security;

create policy horekia_customer_sessions_tenant_select
  on public.horekia_customer_sessions for select
  using (horekia_app.is_tenant_member(tenant_id));

create policy horekia_customer_sessions_tenant_insert
  on public.horekia_customer_sessions for insert
  with check (horekia_app.has_tenant_role(tenant_id, ARRAY['owner', 'editor']::public.horekia_tenant_user_role[]));

create policy horekia_customer_sessions_tenant_update
  on public.horekia_customer_sessions for update
  using (horekia_app.has_tenant_role(tenant_id, ARRAY['owner', 'editor']::public.horekia_tenant_user_role[]))
  with check (horekia_app.has_tenant_role(tenant_id, ARRAY['owner', 'editor']::public.horekia_tenant_user_role[]));

create policy horekia_customer_sessions_tenant_delete
  on public.horekia_customer_sessions for delete
  using (horekia_app.has_tenant_role(tenant_id, ARRAY['owner']::public.horekia_tenant_user_role[]));
