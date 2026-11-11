-- Horekia Fase 1: presupuestos, auditoría, importaciones, vectores y consumo.
create type public.horekia_quote_status as enum ('draft', 'needs_review', 'approved', 'sent', 'accepted', 'rejected', 'expired');
create type public.horekia_quote_event_type as enum ('created', 'updated', 'reviewed', 'approved', 'sent', 'accepted', 'rejected');

create table public.horekia_quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.horekia_tenants(id) on delete cascade,
  request_id uuid,
  status public.horekia_quote_status not null default 'draft',
  currency char(3) not null default 'EUR',
  subtotal numeric(18,4) not null default 0,
  tax_amount numeric(18,4) not null default 0,
  total numeric(18,4) not null default 0,
  configuration_version integer not null check (configuration_version > 0),
  configuration_snapshot jsonb not null default '{}'::jsonb,
  calculation_snapshot jsonb not null default '{}'::jsonb,
  valid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, request_id) references public.horekia_requests(tenant_id, id) on delete set null
);

create table public.horekia_quote_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.horekia_tenants(id) on delete cascade,
  quote_id uuid not null,
  item_id uuid,
  description text not null,
  quantity numeric(18,6) not null,
  unit_price numeric(18,6) not null,
  amount numeric(18,4) not null,
  calculation_trace jsonb not null default '{}'::jsonb,
  unique (tenant_id, id),
  foreign key (tenant_id, quote_id) references public.horekia_quotes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, item_id) references public.horekia_items(tenant_id, id) on delete set null
);

create table public.horekia_quote_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.horekia_tenants(id) on delete cascade,
  quote_id uuid not null,
  event_type public.horekia_quote_event_type not null,
  actor_user_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, quote_id) references public.horekia_quotes(tenant_id, id) on delete cascade
);

create table public.horekia_corrections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.horekia_tenants(id) on delete cascade,
  request_id uuid,
  field_key text not null,
  previous_value jsonb,
  corrected_value jsonb,
  source text not null default 'human' check (source in ('human', 'import')),
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, request_id) references public.horekia_requests(tenant_id, id) on delete cascade
);

-- 768 dimensiones: contrato inicial para el modelo de embeddings elegido antes de activar IA real.
create table public.horekia_embeddings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.horekia_tenants(id) on delete cascade,
  source_type text not null,
  source_id uuid not null,
  content text not null,
  embedding vector(768) not null,
  model text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, source_type, source_id)
);

create table public.horekia_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.horekia_tenants(id) on delete cascade,
  source_name text not null,
  source_type text not null check (source_type in ('csv', 'xlsx', 'document', 'api')),
  status text not null default 'pending' check (status in ('pending', 'preview', 'confirmed', 'failed', 'reverted')),
  mapping jsonb not null default '{}'::jsonb,
  report jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table public.horekia_usage_limits (
  tenant_id uuid primary key references public.horekia_tenants(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  messages_limit integer,
  ai_calls_limit integer,
  storage_bytes_limit bigint,
  check (period_end >= period_start)
);

create table public.horekia_usage_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.horekia_tenants(id) on delete cascade,
  usage_type text not null check (usage_type in ('message', 'ai_call', 'embedding', 'storage')),
  quantity numeric(18,6) not null check (quantity >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index horekia_quotes_tenant_status_idx on public.horekia_quotes(tenant_id, status, created_at desc);
create index horekia_embeddings_tenant_source_idx on public.horekia_embeddings(tenant_id, source_type, source_id);
