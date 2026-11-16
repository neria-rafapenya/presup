-- Horekia: sesiones propias del backoffice para la POC.
-- No usa Supabase Auth; el backend controla el acceso con tokens revocables.
create table if not exists public.horekia_backoffice_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.horekia_tenants(id) on delete cascade,
  email text not null,
  password_hash text not null,
  role public.horekia_tenant_user_role not null default 'owner',
  status public.horekia_record_status not null default 'active',
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  unique (tenant_id, email)
);

create table if not exists public.horekia_backoffice_sessions (
  token_hash text primary key,
  user_id uuid not null references public.horekia_backoffice_users(id) on delete cascade,
  tenant_id uuid not null references public.horekia_tenants(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists horekia_backoffice_sessions_expiry_idx
  on public.horekia_backoffice_sessions(expires_at)
  where revoked_at is null;

alter table public.horekia_backoffice_users enable row level security;
alter table public.horekia_backoffice_sessions enable row level security;

drop policy if exists horekia_backoffice_users_member_select on public.horekia_backoffice_users;
create policy horekia_backoffice_users_member_select on public.horekia_backoffice_users
  for select using (horekia_app.is_tenant_member(tenant_id));

drop policy if exists horekia_backoffice_users_member_update on public.horekia_backoffice_users;
create policy horekia_backoffice_users_member_update on public.horekia_backoffice_users
  for update using (horekia_app.has_tenant_role(tenant_id, ARRAY['owner']::public.horekia_tenant_user_role[]))
  with check (horekia_app.has_tenant_role(tenant_id, ARRAY['owner']::public.horekia_tenant_user_role[]));

drop policy if exists horekia_backoffice_sessions_member_select on public.horekia_backoffice_sessions;
create policy horekia_backoffice_sessions_member_select on public.horekia_backoffice_sessions
  for select using (horekia_app.is_tenant_member(tenant_id));

drop policy if exists horekia_backoffice_sessions_member_insert on public.horekia_backoffice_sessions;
create policy horekia_backoffice_sessions_member_insert on public.horekia_backoffice_sessions
  for insert with check (horekia_app.is_tenant_member(tenant_id));

drop policy if exists horekia_backoffice_sessions_member_update on public.horekia_backoffice_sessions;
create policy horekia_backoffice_sessions_member_update on public.horekia_backoffice_sessions
  for update using (horekia_app.is_tenant_member(tenant_id))
  with check (horekia_app.is_tenant_member(tenant_id));
