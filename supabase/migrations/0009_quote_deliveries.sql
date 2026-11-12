-- Horekia POC: trazabilidad e idempotencia del envío de presupuestos.
create table if not exists public.horekia_quote_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.horekia_tenants(id) on delete cascade,
  quote_id uuid not null,
  request_id uuid not null,
  recipient_email text not null,
  provider text not null default 'resend',
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  provider_message_id text,
  error_message text,
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (tenant_id, quote_id, recipient_email),
  unique (tenant_id, id),
  foreign key (tenant_id, quote_id) references public.horekia_quotes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, request_id) references public.horekia_requests(tenant_id, id) on delete cascade
);

create index if not exists horekia_quote_deliveries_request_idx
  on public.horekia_quote_deliveries(tenant_id, request_id, created_at desc);

alter table public.horekia_quote_deliveries enable row level security;

create policy horekia_quote_deliveries_tenant_select
  on public.horekia_quote_deliveries for select
  using (horekia_app.is_tenant_member(tenant_id));

create policy horekia_quote_deliveries_tenant_insert
  on public.horekia_quote_deliveries for insert
  with check (horekia_app.has_tenant_role(tenant_id, ARRAY['owner', 'editor']::public.horekia_tenant_user_role[]));

create policy horekia_quote_deliveries_tenant_update
  on public.horekia_quote_deliveries for update
  using (horekia_app.has_tenant_role(tenant_id, ARRAY['owner', 'editor']::public.horekia_tenant_user_role[]))
  with check (horekia_app.has_tenant_role(tenant_id, ARRAY['owner', 'editor']::public.horekia_tenant_user_role[]));

create policy horekia_quote_deliveries_tenant_delete
  on public.horekia_quote_deliveries for delete
  using (horekia_app.has_tenant_role(tenant_id, ARRAY['owner']::public.horekia_tenant_user_role[]));
