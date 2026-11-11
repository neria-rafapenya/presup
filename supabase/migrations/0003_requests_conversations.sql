-- Horekia Fase 1: clientes, peticiones, conversación y adjuntos.
create type public.request_status as enum ('new', 'in_progress', 'needs_review', 'quoted', 'closed');
create type public.message_sender as enum ('customer', 'assistant', 'reviewer', 'system');

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text,
  email text,
  phone text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid,
  consent_type text not null,
  granted boolean not null,
  policy_version text,
  granted_at timestamptz not null default now(),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id) on delete set null
);

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid,
  job_type_id uuid,
  status public.request_status not null default 'new',
  intake_data jsonb not null default '{}'::jsonb,
  missing_fields jsonb not null default '[]'::jsonb,
  source text not null default 'chat' check (source in ('chat', 'backoffice', 'import')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id) on delete set null,
  foreign key (tenant_id, job_type_id) references public.job_types(tenant_id, id) on delete set null
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_id uuid not null,
  sender public.message_sender not null,
  body text not null,
  structured_data jsonb,
  provenance jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, request_id) references public.requests(tenant_id, id) on delete cascade
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_id uuid,
  message_id uuid,
  storage_path text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, request_id) references public.requests(tenant_id, id) on delete cascade,
  foreign key (tenant_id, message_id) references public.messages(tenant_id, id) on delete cascade,
  constraint attachments_parent_check check (request_id is not null or message_id is not null)
);

create index requests_tenant_status_idx on public.requests(tenant_id, status, created_at desc);
create index messages_request_created_idx on public.messages(tenant_id, request_id, created_at);
