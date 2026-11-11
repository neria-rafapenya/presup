-- Horekia Fase 1: configuración, fichas y catálogo.
create table public.horekia_sector_packs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  definition jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  status public.horekia_record_status not null default 'active',
  created_at timestamptz not null default now()
);

create table public.horekia_job_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.horekia_tenants(id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  sector_pack_id uuid references public.horekia_sector_packs(id) on delete set null,
  status public.horekia_record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, slug)
);

create table public.horekia_intake_schemas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.horekia_tenants(id) on delete cascade,
  job_type_id uuid not null,
  version integer not null check (version > 0),
  fields jsonb not null default '[]'::jsonb,
  status public.horekia_record_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, job_type_id, version),
  foreign key (tenant_id, job_type_id)
    references public.horekia_job_types(tenant_id, id) on delete cascade
);

create table public.horekia_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.horekia_tenants(id) on delete cascade,
  job_type_id uuid,
  sku text,
  name text not null,
  description text,
  unit text not null default 'unit',
  base_price numeric(18,4),
  currency char(3) not null default 'EUR',
  metadata jsonb not null default '{}'::jsonb,
  status public.horekia_record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, sku),
  foreign key (tenant_id, job_type_id)
    references public.horekia_job_types(tenant_id, id) on delete set null
);

create table public.horekia_item_variables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.horekia_tenants(id) on delete cascade,
  item_id uuid not null,
  code text not null,
  label text not null,
  value_type text not null check (value_type in ('text', 'number', 'boolean', 'choice')),
  definition jsonb not null default '{}'::jsonb,
  unique (tenant_id, id),
  unique (tenant_id, item_id, code),
  foreign key (tenant_id, item_id) references public.horekia_items(tenant_id, id) on delete cascade
);

create table public.horekia_price_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.horekia_tenants(id) on delete cascade,
  job_type_id uuid,
  code text not null,
  kind text not null check (kind in ('unit_price', 'factor', 'surcharge', 'minimum', 'formula')),
  priority integer not null default 100 check (priority >= 0),
  definition jsonb not null,
  version integer not null default 1 check (version > 0),
  status public.horekia_record_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code, version),
  foreign key (tenant_id, job_type_id) references public.horekia_job_types(tenant_id, id) on delete set null
);

create table public.horekia_computed_measures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.horekia_tenants(id) on delete cascade,
  job_type_id uuid,
  code text not null,
  expression jsonb not null,
  version integer not null default 1 check (version > 0),
  unique (tenant_id, id),
  unique (tenant_id, code, version),
  foreign key (tenant_id, job_type_id) references public.horekia_job_types(tenant_id, id) on delete set null
);

create table public.horekia_vocabulary (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.horekia_tenants(id) on delete cascade,
  term text not null,
  canonical_value text not null,
  language text not null default 'es',
  source text not null default 'human' check (source in ('human', 'import', 'ai')),
  created_at timestamptz not null default now(),
  unique (tenant_id, term, language)
);

create table public.horekia_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.horekia_tenants(id) on delete cascade,
  code text not null,
  definition jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  status public.horekia_record_status not null default 'active',
  unique (tenant_id, id),
  unique (tenant_id, code, version)
);

create table public.horekia_faqs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.horekia_tenants(id) on delete cascade,
  question text not null,
  answer text not null,
  language text not null default 'es',
  status public.horekia_record_status not null default 'active',
  unique (tenant_id, id)
);

create index horekia_items_tenant_status_idx on public.horekia_items(tenant_id, status);
create index horekia_rules_tenant_job_priority_idx on public.horekia_price_rules(tenant_id, job_type_id, priority);
