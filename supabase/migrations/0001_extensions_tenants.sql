-- Horekia Fase 1: extensiones, empresa y membresías.
create extension if not exists pgcrypto;
create extension if not exists vector;

create schema if not exists horekia_app;

create type public.horekia_tenant_user_role as enum ('owner', 'editor', 'reviewer');
create type public.horekia_record_status as enum ('active', 'archived');

create table public.horekia_tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status public.horekia_record_status not null default 'active',
  default_locale text not null default 'es-ES',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

-- user_id se mantiene desacoplado de auth.users para que la migración sea importable;
-- la identidad real siempre se valida con auth.uid() y Auth de Supabase.
create table public.horekia_tenant_users (
  tenant_id uuid not null references public.horekia_tenants(id) on delete cascade,
  user_id uuid not null,
  role public.horekia_tenant_user_role not null,
  status public.horekia_record_status not null default 'active',
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create table public.horekia_tenant_settings (
  tenant_id uuid primary key references public.horekia_tenants(id) on delete cascade,
  currency char(3) not null default 'EUR',
  tax_rate numeric(7,4) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  quote_validity_days integer not null default 30 check (quote_validity_days > 0),
  review_required boolean not null default true,
  public_chat_enabled boolean not null default false,
  configuration_version integer not null default 1 check (configuration_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function horekia_app.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.horekia_tenant_users tu
    where tu.tenant_id = p_tenant_id
      and tu.user_id = auth.uid()
      and tu.status = 'active'
  );
$$;

create or replace function horekia_app.has_tenant_role(
  p_tenant_id uuid,
  p_roles public.horekia_tenant_user_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.horekia_tenant_users tu
    where tu.tenant_id = p_tenant_id
      and tu.user_id = auth.uid()
      and tu.status = 'active'
      and tu.role = any(p_roles)
  );
$$;

create index horekia_tenant_users_user_idx on public.horekia_tenant_users(user_id);
